//! The `backups:` of `hangar.yml`: the apps whose data folder Hangar archives, one entry per app.

use regex::Regex;
use serde::Deserialize;
use serde::de::{self, Deserializer};

use super::ConfigError;
use super::cron::Cron;
use super::rules::{Integer, List, MAX_SAFE_INTEGER, Matching, NonEmpty, Pattern, present};
use crate::store::AppId;

/// The backup of one app's data folder.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct Backup {
    /// The app.
    pub app: String,
    /// When it is backed up, a cron expression as node-cron reads it; `None`, only by hand.
    pub schedule: Option<String>,
    /// How many archives to keep, 7 by default: the oldest go once a new one is written.
    pub keep: u64,
    /// Whether the running services are stopped while their files are read: a live database copies inconsistent.
    pub stop: bool,
    /// The folder to back up, under `app-data/`; `None`, the app's own, named after its id.
    pub path: Option<String>,
    /// Globs of the files to archive, relative to the folder, `**` by default.
    pub include: Vec<String>,
    /// Globs of the files and folders to leave out, relative to the folder.
    pub exclude: Vec<String>,
}

impl Backup {
    /// Checks that no app is backed up twice, naming the entry that repeats one.
    pub(super) fn check_unique(backups: &[Self]) -> Result<(), ConfigError> {
        for (index, backup) in backups.iter().enumerate() {
            let is_repeated = backups[..index]
                .iter()
                .any(|earlier| earlier.app == backup.app);

            if is_repeated {
                return Err(ConfigError::invalid(
                    format!("backups[{index}].app"),
                    format!("{} is backed up twice", backup.app),
                ));
            }
        }

        Ok(())
    }
}

/// A backup as `hangar.yml` declares it.
#[derive(Deserialize)]
pub(super) struct BackupFields {
    app: Matching<AppIdPattern>,
    #[serde(default, deserialize_with = "present")]
    schedule: Option<CronExpression>,
    #[serde(default = "BackupFields::default_keep")]
    keep: Integer<1, MAX_SAFE_INTEGER>,
    #[serde(default)]
    stop: bool,
    #[serde(default, deserialize_with = "present")]
    path: Option<FolderUnderAppData>,
    #[serde(default = "BackupFields::default_include")]
    include: List<NonEmpty, 1>,
    #[serde(default)]
    exclude: List<NonEmpty>,
}

impl BackupFields {
    /// How many archives are kept when the entry does not say.
    fn default_keep() -> Integer<1, MAX_SAFE_INTEGER> {
        Integer(7)
    }

    /// Every file, when the entry does not say.
    fn default_include() -> List<NonEmpty, 1> {
        List(vec![NonEmpty("**".to_owned())])
    }
}

impl From<BackupFields> for Backup {
    fn from(fields: BackupFields) -> Self {
        let strings = |list: Vec<NonEmpty>| list.into_iter().map(|glob| glob.0).collect();

        Self {
            app: fields.app.0,
            schedule: fields.schedule.map(|schedule| schedule.0),
            keep: fields.keep.unsigned(),
            stop: fields.stop,
            path: fields.path.map(|path| path.0),
            include: strings(fields.include.0),
            exclude: strings(fields.exclude.0),
        }
    }
}

/// An app id, as [`AppId`] takes one.
#[derive(Debug, Clone)]
struct AppIdPattern;

impl Pattern for AppIdPattern {
    const MESSAGE: &str = "invalid app id";

    fn regex() -> &'static Regex {
        AppId::regex()
    }
}

/// A cron expression that node-cron accepts.
struct CronExpression(String);

impl<'de> Deserialize<'de> for CronExpression {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let expression = String::deserialize(deserializer)?;

        if !Cron::is_valid(&expression) {
            return Err(de::Error::custom("invalid cron expression"));
        }

        Ok(Self(expression))
    }
}

/// A folder under `app-data/`: relative and downward only, no leading `/`, no empty, `.` or `..` segment.
struct FolderUnderAppData(String);

impl<'de> Deserialize<'de> for FolderUnderAppData {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let folder = String::deserialize(deserializer)?;
        let is_downward = folder
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..");

        if !is_downward {
            return Err(de::Error::custom(
                "must be a folder under app-data/, without . or .. segments",
            ));
        }

        Ok(Self(folder))
    }
}
