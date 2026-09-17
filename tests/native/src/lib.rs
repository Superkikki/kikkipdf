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
}
