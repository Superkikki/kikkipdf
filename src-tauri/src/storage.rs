use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
#[derive(Default)]
pub struct Access {
    pub paths: Mutex<HashSet<PathBuf>>,
    pub recent: Mutex<Vec<String>>,
    pub writes: Mutex<HashMap<String, PathBuf>>,
}
pub fn ui_error(context: &str, error: impl std::fmt::Display) -> String {
    eprintln!("[kikki] {context}: {error}");
    format!("{context}。ファイルの場所とアクセス権を確認してください。")
}
pub fn allow(access: &Access, path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| ui_error("ファイルを確認できません", e))?;
    access
        .paths
        .lock()
        .map_err(|_| "ファイルアクセス状態を取得できません。")?
        .insert(canonical.clone());
    Ok(canonical)
}
pub fn authorized(access: &Access, path: &str) -> Result<PathBuf, String> {
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|e| ui_error("ファイルを確認できません", e))?;
    if !access
        .paths
        .lock()
        .map_err(|_| "ファイルアクセス状態を取得できません。")?
        .contains(&canonical)
    {
        return Err("ファイル選択ダイアログからファイルを開いてください。".into());
    }
    Ok(canonical)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("保存先が不正です。")?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| ui_error("保存用ファイルを作成できません", e))?;
    tmp.write_all(bytes)
        .map_err(|e| ui_error("書き込みに失敗しました", e))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| ui_error("書き込みを確定できません", e))?;
    tmp.persist(path)
        .map_err(|e| ui_error("ファイルを置き換えできません", e.error))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn atomic_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("test.pdf");
        atomic_write(&p, b"old").unwrap();
        atomic_write(&p, b"new").unwrap();
        assert_eq!(fs::read(p).unwrap(), b"new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn rejects_unselected_path() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("secret.pdf");
        fs::write(&p, b"test").unwrap();
        assert!(authorized(&Access::default(), p.to_str().unwrap()).is_err());
    }
}
