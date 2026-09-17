use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, Permissions};
use std::{collections::BTreeMap, sync::Arc};
use zeroize::Zeroizing;

pub fn decrypt(bytes: &[u8], password: String) -> Result<Vec<u8>, String> {
    let password = Zeroizing::new(password);
    let mut doc =
        Document::load_mem_with_options(bytes, lopdf::LoadOptions::with_password(&password))
            .map_err(|_| "パスワードが違うかPDFを解析できません。")?;
    if doc.is_encrypted() {
        doc.decrypt(&password)
            .map_err(|_| "パスワードが違うか、この暗号化方式には対応していません。")?;
    }
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|_| "復号したPDFを生成できません。")?;
    Ok(out)
}
pub fn encrypt(bytes: &[u8], password: String) -> Result<Vec<u8>, String> {
    let password = Zeroizing::new(password);
    if password.len() < 8 {
        return Err("パスワードは8文字以上にしてください。".into());
    }
    let mut doc = Document::load_mem(bytes).map_err(|_| "PDFを解析できません。")?;
    // AES-256 revision 6, independent random file key and owner credential.
    let key: [u8; 32] = rand::random();
    let owner = Zeroizing::new(format!("{:x?}", rand::random::<[u8; 32]>()));
    // Old cross-reference/object streams have been expanded by the parser.
    // They must not be encrypted or carried into the new serialization.
    doc.objects.retain(|_, object| {
        !object
            .as_stream()
            .is_ok_and(|s| s.dict.has_type(b"XRef") || s.dict.has_type(b"ObjStm"))
    });
    doc.reference_table.cross_reference_type = lopdf::xref::XrefType::CrossReferenceTable;
    for key in [
        b"Type".as_slice(),
        b"W",
        b"Index",
        b"Length",
        b"Filter",
        b"DecodeParms",
        b"Prev",
        b"XRefStm",
    ] {
        doc.trailer.remove(key);
    }
    let state = EncryptionState::try_from(EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(
            b"StdCF".to_vec(),
            Arc::new(Aes256CryptFilter) as Arc<dyn CryptFilter>,
        )]),
        file_encryption_key: &key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: &owner,
        user_password: &password,
        permissions: Permissions::all(),
    })
    .map_err(|_| "暗号化の初期化に失敗しました。")?;
    doc.encrypt(&state).map_err(|_| "PDFを暗号化できません。")?;
    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|_| "暗号化PDFを生成できません。")?;
    Ok(out)
}
