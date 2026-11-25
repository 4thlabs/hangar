//! YAML as the Waku version loads it with js-yaml: one document, its merge keys applied.

use serde_norway::Value;

/// A YAML source that does not load: its syntax, a stream of several documents, or none at all. Its type stays
/// private, so that the YAML parser can be replaced.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct YamlError(Box<dyn std::error::Error + Send + Sync>);

/// js-yaml's answer to a source that holds no document: only blank lines and comments.
#[derive(Debug, thiserror::Error)]
#[error("expected a document, but the input is empty")]
struct NoDocument;

/// Loads YAML as js-yaml does.
pub(crate) struct Yaml;

impl Yaml {
    /// The single document of `source`, with its merge keys (`<<: *base`) applied. serde_norway reads a source without
    /// a document as `null`, where js-yaml fails: so does this, so that an empty file fails in both versions.
    pub(crate) fn load(source: &str) -> Result<Value, YamlError> {
        if !Self::has_document(source) {
            return Err(YamlError(Box::new(NoDocument)));
        }

        let mut document: Value =
            serde_norway::from_str(source).map_err(|error| YamlError(Box::new(error)))?;

        document
            .apply_merge()
            .map_err(|error| YamlError(Box::new(error)))?;

        Ok(document)
    }

    /// Whether `source` holds anything but blank lines and comments.
    fn has_document(source: &str) -> bool {
        source.lines().any(|line| {
            let line = line.trim();

            !line.is_empty() && !line.starts_with('#')
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_norway::Value;

    use super::Yaml;

    #[test]
    fn applies_the_merge_keys() {
        let document =
            Yaml::load("base: &base { image: nginx }\nweb:\n  <<: *base\n  restart: always\n")
                .expect("the YAML is valid");

        assert_eq!(document["web"]["image"], Value::from("nginx"));
        assert_eq!(document["web"]["restart"], Value::from("always"));
    }

    #[test]
    fn fails_on_a_source_without_a_document_as_js_yaml_does() {
        for source in ["", "\n  \n", "# a comment\n  # another\n"] {
            let error = Yaml::load(source).expect_err("there is no document");

            assert_eq!(
                error.to_string(),
                "expected a document, but the input is empty"
            );
        }
    }

    #[test]
    fn fails_on_several_documents_and_on_a_duplicate_key() {
        assert!(Yaml::load("a: 1\n---\nb: 2\n").is_err());
        assert!(Yaml::load("a: 1\na: 2\n").is_err());
    }

    #[test]
    fn reads_true_as_a_boolean_and_yes_as_a_string_as_yaml_1_2_does() {
        let document = Yaml::load("a: True\nb: yes\n").expect("the YAML is valid");

        assert_eq!(document["a"], Value::Bool(true));
        assert_eq!(document["b"], Value::from("yes"));
    }
}
