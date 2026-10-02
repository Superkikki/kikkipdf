mod security;
mod storage;
use std::{fs, path::Path};
use storage::{allow, atomic_write, authorized, ui_error, Access};
use tauri::{Manager, State};
fn remember(app: &tauri::AppHandle, access: &Access, path: &Path) -> Result<(), String> {
    let mut recent = access.recent.lock().map_err(|_| "履歴を取得できません。")?;
    let name = path.to_string_lossy().to_string();
    recent.retain(|p| p != &name);
    recent.insert(0, name);
    recent.truncate(12);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "設定フォルダーを取得できません。")?;
    fs::create_dir_all(&dir).map_err(|e| ui_error("設定を保存できません", e))?;
    let bytes = serde_json::to_vec(&*recent).map_err(|_| "履歴を保存できません。")?;
    atomic_write(&dir.join("recent.json"), &bytes)
}
#[tauri::command]
async fn select_files(
    app: tauri::AppHandle,
    kind: String,
    multiple: bool,
) -> Result<Vec<String>, String> {
    let remember_documents = kind != "attachment" && kind != "font";
    let paths = tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new();
        let dialog = if kind == "image" {
            dialog.add_filter("Images", &["png", "jpg", "jpeg"])
        } else if kind == "project" {
            dialog.add_filter("Kikki PDF Project", &["kpdf"])
        } else if kind == "font" {
            dialog.add_filter("Static TrueType / OpenType", &["ttf", "otf"])
        } else if kind == "attachment" {
            dialog
        } else {
            dialog.add_filter("PDF / Kikki Project", &["pdf", "kpdf"])
        };
        if multiple {
            dialog.pick_files().unwrap_or_default()
        } else {
            dialog.pick_file().into_iter().collect()
        }
    })
    .await
    .map_err(|_| "ファイル選択を完了できません。")?;
    let access = app.state::<Access>();
    let mut result = Vec::new();
    for p in paths {
        let p = allow(&access, &p)?;
        result.push(p.to_string_lossy().to_string());
        if remember_documents
            && p.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("pdf") || e.eq_ignore_ascii_case("kpdf"))
        {
            remember(&app, &access, &p)?;
        }
    }
    Ok(result)
}
#[tauri::command]
async fn read_document(
    app: tauri::AppHandle,
    path: String,
    max_bytes: Option<u64>,
) -> Result<tauri::ipc::Response, String> {
    let p = authorized(&app.state::<Access>(), &path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        if let Some(limit) = max_bytes {
            use std::io::Read;
            let limit = limit.min(32 * 1024 * 1024);
            let file = fs::File::open(p)?;
            let mut bytes = Vec::new();
            file.take(limit + 1).read_to_end(&mut bytes)?;
            if bytes.len() as u64 > limit {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "File exceeds font size limit",
                ));
            }
            Ok(bytes)
        } else {
            fs::read(p)
        }
    })
    .await
    .map_err(|_| "ファイル読み込みを完了できません。")?
    .map_err(|e| ui_error("ファイルを読み込めません", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
async fn prepare_save(
    app: tauri::AppHandle,
    name: String,
    path: Option<String>,
) -> Result<Option<String>, String> {
    let target = if let Some(path) = path {
        authorized(&app.state::<Access>(), &path)?
    } else {
        let choice = tauri::async_runtime::spawn_blocking(move || {
            rfd::FileDialog::new().set_file_name(&name).save_file()
        })
        .await
        .map_err(|_| "保存先を選択できません。")?;
        let Some(path) = choice else {
            return Ok(None);
        };
        path
    };
    let token = format!("{:032x}", rand::random::<u128>());
    app.state::<Access>()
        .writes
        .lock()
        .map_err(|_| "保存状態を取得できません。")?
        .insert(token.clone(), target);
    Ok(Some(token))
}
#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let token = request
        .headers()
        .get("x-kikki-token")
        .and_then(|v| v.to_str().ok())
        .ok_or("保存先が未選択です。")?;
    let path = app
        .state::<Access>()
        .writes
        .lock()
        .map_err(|_| "保存状態を取得できません。")?
        .remove(token)
        .ok_or("保存の許可がありません。")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("PDFデータの形式が不正です。".into()),
    };
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || atomic_write(&target, &bytes))
        .await
        .map_err(|_| "保存を完了できません。")??;
    let access = app.state::<Access>();
    let canonical = allow(&access, &path)?;
    if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf") || e.eq_ignore_ascii_case("kpdf"))
    {
        remember(&app, &access, &canonical)?;
    }
    Ok(canonical.to_string_lossy().to_string())
}
#[tauri::command]
fn startup_documents(access: State<Access>) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for arg in std::env::args().skip(1) {
        let p = Path::new(&arg);
        if p.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("pdf") || e.eq_ignore_ascii_case("kpdf"))
        {
            let canonical = allow(&access, p)?;
            result.push(canonical.to_string_lossy().to_string());
        }
    }
    Ok(result)
}
#[tauri::command]
fn recent_documents(access: State<Access>) -> Result<Vec<String>, String> {
    Ok(access
        .recent
        .lock()
        .map_err(|_| "履歴を取得できません。")?
        .clone())
}
#[tauri::command]
async fn decrypt_pdf(bytes: Vec<u8>, password: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        security::decrypt(&bytes, password).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "復号処理を完了できません。")?
}
#[tauri::command]
async fn encrypt_pdf(bytes: Vec<u8>, password: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        security::encrypt(&bytes, password).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "暗号化処理を完了できません。")?
}
pub fn run() {
    let result = tauri::Builder::default()
        .manage(Access::default())
        .setup(|app| {
            let access = app.state::<Access>();
            if let Ok(dir) = app.path().app_data_dir() {
                if let Ok(bytes) = fs::read(dir.join("recent.json")) {
                    if let Ok(paths) = serde_json::from_slice::<Vec<String>>(&bytes) {
                        for p in paths.iter().take(12) {
                            let _ = allow(&access, Path::new(p));
                        }
                        if let Ok(mut r) = access.recent.lock() {
                            *r = paths.into_iter().take(12).collect();
                        }
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let access = window.state::<Access>();
                for path in paths {
                    if path.extension().is_some_and(|e| {
                        e.eq_ignore_ascii_case("pdf") || e.eq_ignore_ascii_case("kpdf")
                    }) {
                        let _ = allow(&access, path);
                        let _ = remember(window.app_handle(), &access, path);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_files,
            read_document,
            prepare_save,
            save_document,
            recent_documents,
            startup_documents,
            decrypt_pdf,
            encrypt_pdf
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("[kikki] application startup failed: {error}");
    }
}
