use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::{fs, io::Read};

const INPUT_LIMIT: usize = 32 * 1024 * 1024;
const OUTPUT_LIMIT: u64 = 128 * 1024 * 1024;
static CONVERSION: Mutex<()> = Mutex::new(());

pub fn convert_request(payload: &[u8]) -> Result<Vec<u8>, String> {
    let (&kind, bytes) = payload.split_first().ok_or("変換するファイルがありません。")?;
    let (source_ext, output_ext) = match kind {
        1 => ("docx", "pdf"),
        2 => ("xlsx", "pdf"),
        3 => ("pptx", "pdf"),
        _ => return Err("変換形式に対応していません。".into()),
    };
    if bytes.len() > INPUT_LIMIT || bytes.is_empty() {
        return Err("変換するファイルは32MBまでです。".into());
    }
    if (source_ext == "pdf" && !bytes.starts_with(b"%PDF-"))
        || (source_ext != "pdf" && !bytes.starts_with(b"PK\x03\x04"))
    {
        return Err("ファイルの形式が正しくありません。".into());
    }
    let _guard = CONVERSION.try_lock().map_err(|_| "別のOffice変換が進行中です。完了後に再試行してください。")?;
    convert(bytes, source_ext, output_ext)
}

#[cfg(target_os = "windows")]
fn convert(bytes: &[u8], source_ext: &str, output_ext: &str) -> Result<Vec<u8>, String> {
    use std::{os::windows::process::CommandExt, process::{Command, Stdio}, thread, time::{Duration, Instant}};
    let dir = tempfile::tempdir().map_err(|_| "一時フォルダーを作成できません。")?;
    let source = dir.path().join(format!("source.{source_ext}"));
    let output = dir.path().join(format!("output.{output_ext}"));
    let script = dir.path().join("convert.ps1");
    fs::write(&source, bytes).map_err(|_| "変換用の一時ファイルを作成できません。")?;
    fs::write(&script, include_str!("../office/convert.ps1"))
        .map_err(|_| "変換処理を準備できません。")?;
    let system_root = std::env::var_os("SystemRoot").ok_or("Windowsのシステムフォルダーを確認できません。")?;
    let powershell = std::path::PathBuf::from(system_root).join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    let mut child = Command::new(powershell)
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script).arg("-Kind").arg(source_ext).arg("-Source").arg(source).arg("-Output").arg(&output)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn().map_err(|_| "Office変換を開始できません。WindowsとMicrosoft Officeのインストールを確認してください。")?;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return Err("Office変換に失敗しました。対応するMicrosoft Officeのインストール、ライセンス、ファイルの状態を確認し、開いているOffice文書を閉じて再試行してください。".into()),
            Err(_) => return Err("Office変換を完了できません。".into()),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Office変換がタイムアウトしました。Officeの初回設定やダイアログを確認してください。".into());
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
        }
    }
    let file = fs::File::open(&output).map_err(|_| "Officeの出力ファイルがありません。")?;
    let mut result = Vec::new();
    file.take(OUTPUT_LIMIT + 1).read_to_end(&mut result).map_err(|_| "Officeの出力ファイルを読み込めません。")?;
    if result.len() as u64 > OUTPUT_LIMIT { return Err("変換結果が128MBを超えています。".into()); }
    if (output_ext == "pdf" && !result.starts_with(b"%PDF-")) || (output_ext == "docx" && !result.starts_with(b"PK\x03\x04")) {
        return Err("Officeの変換結果が不正です。".into());
    }
    Ok(result)
}

#[cfg(not(target_os = "windows"))]
fn convert(_: &[u8], _: &str, _: &str) -> Result<Vec<u8>, String> {
    Err("Office変換はMicrosoft OfficeをインストールしたWindows版で利用できます。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unrecognized_empty_oversized_and_wrong_format_input() {
        assert!(convert_request(&[]).is_err());
        assert!(convert_request(&[0, 1]).is_err());
        assert!(convert_request(&[1]).is_err());
        assert!(convert_request(b"\x01%PDF-1.7").is_err());
        assert!(convert_request(b"\x04PK\x03\x04").is_err());
        let mut input = vec![0; INPUT_LIMIT + 2];
        input[0] = 1;
        input[1..5].copy_from_slice(b"PK\x03\x04");
        assert!(convert_request(&input).is_err());
    }
}
