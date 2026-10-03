#[path = "../../../src-tauri/src/security.rs"]
pub mod security;
#[path = "../../../src-tauri/src/storage.rs"]
pub mod storage;
#[cfg(test)]
mod tests {
    use super::security;
    use lopdf::{dictionary, Document, Object, Stream};
    fn fixture() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let content = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf 30 40 Td (secret document) Tj ET".to_vec(),
        ));
        let page=doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages,"MediaBox"=>vec![0.into(),0.into(),300.into(),400.into()],"Contents"=>content});
        doc.objects.insert(
            pages,
            Object::Dictionary(dictionary! {"Type"=>"Pages","Kids"=>vec![page.into()],"Count"=>1}),
        );
        let root = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});
        doc.trailer.set("Root", root);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }
    #[test]
    fn aes256_round_trip_and_wrong_password() {
        let bytes = fixture();
        let encrypted = security::encrypt(&bytes, "test-password-123".into()).unwrap();
        let raw = Document::load_mem(&encrypted).unwrap();
        assert!(raw.is_encrypted());
        assert!(!String::from_utf8_lossy(&encrypted).contains("secret document"));
        assert!(security::decrypt(&encrypted, "wrong-password".into()).is_err());
        let decrypted = security::decrypt(&encrypted, "test-password-123".into()).unwrap();
        let doc = Document::load_mem(&decrypted).unwrap();
        assert!(!doc.is_encrypted());
        assert_eq!(doc.get_pages().len(), 1);
        let page = *doc.get_pages().values().next().unwrap();
        assert!(String::from_utf8_lossy(&doc.get_page_content(page)).contains("secret document"));
    }
    #[test]
    fn refuses_weak_password() {
        assert!(security::encrypt(&fixture(), "short".into()).is_err());
    }
    #[test]
    fn malformed_pdf_returns_error() {
        assert!(security::decrypt(b"not a pdf", "password".into()).is_err());
    }
    fn envelope(pdf: &[u8], password: &str) -> Vec<u8> {
        let mut payload = (password.len() as u32).to_le_bytes().to_vec();
        payload.extend_from_slice(password.as_bytes());
        payload.extend_from_slice(pdf);
        payload
    }
    #[test]
    fn raw_ipc_round_trip_with_unicode_password() {
        let password = "日本語password";
        let encrypted = security::transform_request(envelope(&fixture(), password), true).unwrap();
        assert!(security::transform_request(envelope(&encrypted, "incorrect"), false).is_err());
        let decrypted = security::transform_request(envelope(&encrypted, password), false).unwrap();
        assert_eq!(Document::load_mem(&decrypted).unwrap().get_pages().len(), 1);
    }
    #[test]
    fn rejects_truncated_and_invalid_raw_ipc() {
        for payload in [
            vec![],
            vec![1, 2, 3],
            vec![255, 255, 255, 255],
            vec![1, 0, 0, 0, 255, 1],
            vec![1, 0, 0, 0, 97],
        ] {
            assert!(security::transform_request(payload, true).is_err());
        }
    }
}
