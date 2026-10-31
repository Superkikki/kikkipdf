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
    format!("{context}。詳細: {error}")
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
#[derive(Debug)]
pub struct WriteError {
    context: &'static str,
    source: std::io::Error,
}
impl WriteError {
    pub fn access_denied(&self) -> bool {
        if self.source.kind() == std::io::ErrorKind::PermissionDenied {
            return true;
        }
        // Windows also refuses replacement while another application holds the file.
        #[cfg(windows)]
        if matches!(self.source.raw_os_error(), Some(32 | 33)) {
            return true;
        }
        false
    }
}
impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", ui_error(self.context, &self.source))
    }
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), WriteError> {
    let parent = path.parent().ok_or_else(|| WriteError {
        context: "保存先が不正です",
        source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "保存先フォルダーがありません"),
    })?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|source| WriteError { context: "保存用ファイルを作成できません", source })?;
    tmp.write_all(bytes)
        .map_err(|source| WriteError { context: "書き込みに失敗しました", source })?;
    tmp.as_file()
        .sync_all()
        .map_err(|source| WriteError { context: "書き込みを確定できません", source })?;
    tmp.persist(path)
        .map_err(|e| WriteError { context: "ファイルを置き換えできません", source: e.error })?;
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
    #[test]
    fn reports_missing_folder_without_calling_it_a_permission_error() {
        let dir = tempfile::tempdir().unwrap();
        let error = atomic_write(&dir.path().join("missing/test.pdf"), b"new").unwrap_err();
        assert!(!error.access_denied());
        assert!(error.to_string().contains("詳細:"));
    }
    #[cfg(unix)]
    #[test]
    fn denied_folder_preserves_original_and_cleans_up() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("test.pdf");
        fs::write(&p, b"original").unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();
        let result = atomic_write(&p, b"edited");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.unwrap_err().access_denied());
        assert_eq!(fs::read(p).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[cfg(windows)]
    #[test]
    fn locked_file_preserves_original_and_cleans_up() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("test.pdf");
        fs::write(&p, b"original").unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(&p).unwrap();
        let result = atomic_write(&p, b"edited");
        drop(lock);
        assert!(result.unwrap_err().access_denied());
        assert_eq!(fs::read(p).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
