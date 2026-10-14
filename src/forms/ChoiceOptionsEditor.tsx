import type { ChoiceOption } from "../state/model";

export function ChoiceOptionsEditor({ options, onChange, prefix = "選択肢" }: {
  options: ChoiceOption[];
  onChange: (options: ChoiceOption[]) => void;
  prefix?: string;
}) {
  return <>
    {options.map((option, index) => (
      <div className="form-kind-buttons" key={index}>
        <label>表示名
          <input aria-label={`${prefix}${index + 1}の表示名`} value={option.label}
            onChange={event => onChange(options.map((option, i) => i === index ? { ...option, label: event.target.value } : option))} />
        </label>
        <label>保存値
          <input aria-label={`${prefix}${index + 1}の保存値`} value={option.value}
            onChange={event => onChange(options.map((option, i) => i === index ? { ...option, value: event.target.value } : option))} />
        </label>
        <button aria-label={`${prefix}${index + 1}を削除`} onClick={() => onChange(options.filter((_, i) => i !== index))}>削除</button>
      </div>
    ))}
    <button onClick={() => onChange([...options, { value: "", label: "" }])}>{prefix}を追加</button>
  </>;
}
