import {
  PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNull,
  PDFNumber, PDFObject, PDFObjectCopier, PDFRef, PDFString,
  type PDFDocument,
} from "pdf-lib";

const key = (name: string) => PDFName.of(name);
const configKeys = ["Name", "Creator", "BaseState", "ON", "OFF", "Intent", "AS", "Order", "ListMode", "RBGroups", "Locked"];
export interface OptionalContentPart {
  groups: PDFRef[];
  defaultConfig: PDFDict;
  configs?: PDFArray;
}

/** Use the page copier's mapping: a second copier would create unrelated OCGs. */
export class OptionalContentSource {
  private groups = new Map<PDFObject, PDFRef>();
  private properties?: PDFDict;
  private remaining = 100_000;

  constructor(
    private input: PDFDocument,
    private output: PDFDocument,
    private copier: PDFObjectCopier,
    private visibility: Record<string, boolean> = {},
    names: Record<string, string> = {},
  ) {
    const properties = input.context.lookup(input.catalog.get(key("OCProperties")));
    if (!(properties instanceof PDFDict)) {
      if (Object.keys(visibility).length || Object.keys(names).length) throw Error("表示を変更したレイヤーが見つかりません。");
      return;
    }
    this.properties = properties;
    const groups = input.context.lookup(properties.get(key("OCGs")));
    if (!(groups instanceof PDFArray)) throw Error("PDFのレイヤー一覧が不正です。");
    if (groups.size() > 10_000) throw Error("PDFのレイヤー数が保存上限を超えています。");
    const known = new Set(groups.asArray().filter((ref): ref is PDFRef => ref instanceof PDFRef)
      .map((ref) => `${ref.objectNumber}R${ref.generationNumber || ""}`));
    for (const [id, visible] of Object.entries(visibility)) {
      if (!known.has(id) || typeof visible !== "boolean") throw Error("表示を変更したレイヤーの参照が不正です。");
    }
    for (const [id, name] of Object.entries(names)) {
      if (!known.has(id) || typeof name !== "string" || !name.trim() || name.length > 1000)
        throw Error("変更したレイヤー名または参照が不正です。");
    }
    const locked = properties.lookupMaybe(key("D"), PDFDict)?.lookupMaybe(key("Locked"), PDFArray);
    if (locked) for (const ref of locked.asArray()) {
      if (ref instanceof PDFRef && `${ref.objectNumber}R${ref.generationNumber || ""}` in visibility)
        throw Error("ロックされたレイヤーの表示は変更できません。");
    }
    // Sanitize only the in-memory source, before its pages are copied. OCG metadata
    // must not cause a catalog copy to import page trees or executable actions.
    for (let i = 0; i < groups.size(); i++) {
      const ref = groups.get(i);
      const group = input.context.lookup(ref);
      if (!(ref instanceof PDFRef) || !(group instanceof PDFDict) || group.get(key("Type")) !== key("OCG"))
        throw Error("PDFのレイヤー定義が不正です。");
      const safe = new Map<PDFName, PDFObject>();
      safe.set(key("Type"), key("OCG"));
      for (const name of ["Name", "Intent", "Usage"]) {
        const value = this.value(group.get(key(name)), 0, false);
        if (value) safe.set(key(name), value);
      }
      for (const name of group.keys()) group.delete(name);
      for (const [name, value] of safe) group.set(name, value);
      const changedName = names[`${ref.objectNumber}R${ref.generationNumber || ""}`];
      if (changedName !== undefined) group.set(key("Name"), PDFHexString.fromText(changedName));
      const visible = visibility[`${ref.objectNumber}R${ref.generationNumber || ""}`];
      if (visible !== undefined) {
        const usage = group.lookupMaybe(key("Usage"), PDFDict) ?? this.output.context.obj({});
        const view = usage.lookupMaybe(key("View"), PDFDict) ?? this.output.context.obj({});
        view.set(key("ViewState"), key(visible ? "ON" : "OFF"));
        usage.set(key("View"), view);
        group.set(key("Usage"), usage);
      }
      this.groups.set(ref, ref);
      this.groups.set(group, ref);
    }
  }

  private value(value: PDFObject | undefined, depth = 0, allowGroups = true): PDFObject | undefined {
    if (!value) return;
    if (--this.remaining < 0 || depth > 32)
      throw Error("PDFのレイヤー設定が複雑すぎるため保存できません。");
    const group = allowGroups ? this.groups.get(value) : undefined;
    if (group) return this.copier.copy(group);
    if (value instanceof PDFRef) {
      return this.value(this.input.context.lookup(value), depth + 1, allowGroups);
    }
    if (value instanceof PDFString || value instanceof PDFHexString || value instanceof PDFName ||
        value instanceof PDFNumber || value instanceof PDFBool || value === PDFNull)
      return value.clone();
    if (value instanceof PDFArray) {
      const array = this.output.context.obj([]);
      for (let i = 0; i < value.size(); i++) {
        const item = this.value(value.get(i), depth + 1, allowGroups);
        if (item) array.push(item);
      }
      return array;
    }
    if (value instanceof PDFDict) {
      const type = value.get(key("Type"));
      if (allowGroups && type === key("OCG"))
        throw Error("PDFのレイヤー設定に一覧外のグループ参照があります。");
      if (type && type !== key("OCG")) return;
      const dict = this.output.context.obj({});
      for (const [name, item] of value.entries()) {
        const safe = this.value(item, depth + 1, allowGroups);
        if (safe) dict.set(name, safe);
      }
      return dict;
    }
    // Streams are not optional-content configuration data.
  }

  private config(value: PDFObject | undefined): PDFDict {
    const original = this.input.context.lookup(value);
    const config = this.output.context.obj({});
    if (original instanceof PDFDict) for (const name of configKeys) {
      const item = this.value(original.get(key(name)));
      if (item) config.set(key(name), item);
    }
    return config;
  }

  finish(): OptionalContentPart | undefined {
    if (!this.properties || !this.groups.size) return;
    const groups = [...new Set(this.groups.values())].map((ref) => this.copier.copy(ref));
    const configs = this.input.context.lookup(this.properties.get(key("Configs")));
    let copiedConfigs: PDFArray | undefined;
    if (configs instanceof PDFArray) {
      if (configs.size() > 10_000) throw Error("PDFのレイヤー表示設定が保存上限を超えています。");
      copiedConfigs = this.output.context.obj([]);
      for (let i = 0; i < configs.size(); i++) copiedConfigs.push(this.config(configs.get(i)));
    }
    const defaultConfig = this.config(this.properties.get(key("D")));
    const overrides = new Map([...new Set(this.groups.values())].flatMap((ref) => {
      const visible = this.visibility[`${ref.objectNumber}R${ref.generationNumber || ""}`];
      return visible === undefined ? [] : [[this.copier.copy(ref), visible] as const];
    }));
    if (overrides.size) for (const [name, visible] of [["ON", true], ["OFF", false]] as const) {
      const original = defaultConfig.lookupMaybe(key(name), PDFArray);
      const refs = (original?.asArray() ?? []).filter((ref) => !(ref instanceof PDFRef && overrides.has(ref)));
      for (const [ref, state] of overrides) if (state === visible) refs.push(ref);
      defaultConfig.set(key(name), this.output.context.obj(refs));
    }
    return { groups, defaultConfig, configs: copiedConfigs };
  }
}

export function writeOptionalContent(output: PDFDocument, parts: (OptionalContentPart | undefined)[]) {
  const sources = parts.filter((part): part is OptionalContentPart => !!part);
  if (!sources.length) return;
  const groups = sources.flatMap((part) => part.groups);
  const properties = output.context.obj({ OCGs: groups });
  if (sources.length === 1) {
    properties.set(key("D"), sources[0].defaultConfig);
    if (sources[0].configs) properties.set(key("Configs"), sources[0].configs);
  } else {
    const config = output.context.obj({ BaseState: "ON" });
    const on: PDFRef[] = [], off: PDFRef[] = [];
    for (const part of sources) {
      const state = new Map(part.groups.map((ref) => [ref, part.defaultConfig.get(key("BaseState")) !== key("OFF")]));
      for (const [name, visible] of [["ON", true], ["OFF", false]] as const) {
        const list = part.defaultConfig.lookupMaybe(key(name), PDFArray);
        if (list) for (let i = 0; i < list.size(); i++) {
          const ref = list.get(i);
          if (ref instanceof PDFRef && state.has(ref)) state.set(ref, visible);
        }
      }
      for (const [ref, visible] of state) (visible ? on : off).push(ref);
    }
    config.set(key("ON"), output.context.obj(on));
    config.set(key("OFF"), output.context.obj(off));
    for (const name of ["Order", "AS", "Locked", "RBGroups"]) {
      const combined = output.context.obj([]);
      for (const part of sources) {
        const list = part.defaultConfig.lookupMaybe(key(name), PDFArray);
        if (list) for (let i = 0; i < list.size(); i++) combined.push(list.get(i));
        else if (name === "Order") for (const ref of part.groups) combined.push(ref);
      }
      if (combined.size()) config.set(key(name), combined);
    }
    const intents = new Set<PDFName>();
    for (const part of sources) {
      const intent = part.defaultConfig.get(key("Intent"));
      if (intent instanceof PDFArray) for (let i = 0; i < intent.size(); i++) {
        const value = intent.get(i);
        if (value instanceof PDFName) intents.add(value);
      }
      else intents.add(intent instanceof PDFName ? intent : key("View"));
    }
    config.set(key("Intent"), output.context.obj([...intents]));
    properties.set(key("D"), config);
  }
  output.catalog.set(key("OCProperties"), properties);
}
