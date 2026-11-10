//! Minimal stand-in for the parts of the `tauri` crate used by Loom's backend.
//! It lets the exact same backend modules compile into a headless sidecar.
use std::{
    any::Any,
    fmt,
    marker::PhantomData,
    ops::Deref,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};

use serde::Serialize;
use serde_json::Value;

pub use tauri_command_shim::command;

type EmitterFn = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Clone)]
pub struct AppHandle {
    inner: Arc<Inner>,
}

struct Inner {
    config_dir: PathBuf,
    version: String,
    state: OnceLock<Arc<dyn Any + Send + Sync>>,
    emitter: Mutex<Option<EmitterFn>>,
}

impl AppHandle {
    pub fn new(config_dir: PathBuf, version: impl Into<String>, emitter: EmitterFn) -> Self {
        Self {
            inner: Arc::new(Inner {
                config_dir,
                version: version.into(),
                state: OnceLock::new(),
                emitter: Mutex::new(Some(emitter)),
            }),
        }
    }

    pub fn set_state<T: Any + Send + Sync>(&self, value: Arc<T>) {
        let _ = self.inner.state.set(value);
    }

    pub fn path(&self) -> PathResolver {
        PathResolver {
            config_dir: self.inner.config_dir.clone(),
        }
    }

    pub fn package_info(&self) -> PackageInfo {
        PackageInfo {
            name: "Loom".to_string(),
            version: self.inner.version.clone(),
        }
    }

    pub fn emit<S: Serialize>(&self, event: &str, payload: S) -> Result<(), Error> {
        let value = serde_json::to_value(payload).map_err(|e| Error(e.to_string()))?;
        if let Some(emitter) = self.inner.emitter.lock().unwrap().as_ref() {
            emitter(event, value);
        }
        Ok(())
    }
}

pub trait Emitter {}
impl Emitter for AppHandle {}

pub trait Manager {
    fn state<T: Any + Send + Sync>(&self) -> State<'_, T>;
}

impl Manager for AppHandle {
    fn state<T: Any + Send + Sync>(&self) -> State<'_, T> {
        let any = self
            .inner
            .state
            .get()
            .expect("sidecar state must be registered before use");
        let arc = any
            .clone()
            .downcast::<T>()
            .expect("sidecar state type mismatch");
        State {
            arc,
            _lifetime: PhantomData,
        }
    }
}

pub struct State<'a, T> {
    arc: Arc<T>,
    _lifetime: PhantomData<&'a T>,
}

impl<'a, T> State<'a, T> {
    pub fn new(arc: Arc<T>) -> Self {
        Self {
            arc,
            _lifetime: PhantomData,
        }
    }
}

impl<T> Deref for State<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.arc
    }
}

pub struct PathResolver {
    config_dir: PathBuf,
}

impl PathResolver {
    pub fn app_config_dir(&self) -> Result<PathBuf, Error> {
        Ok(self.config_dir.clone())
    }

    pub fn app_data_dir(&self) -> Result<PathBuf, Error> {
        Ok(self.config_dir.clone())
    }

    pub fn home_dir(&self) -> Result<PathBuf, Error> {
        dirs_home().ok_or_else(|| Error("cannot locate home directory".into()))
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

pub struct PackageInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct Error(String);

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}

pub mod async_runtime {
    pub type JoinHandle<T> = tokio::task::JoinHandle<T>;

    pub fn spawn<F>(future: F) -> JoinHandle<F::Output>
    where
        F: std::future::Future + Send + 'static,
        F::Output: Send + 'static,
    {
        tokio::spawn(future)
    }

    pub fn spawn_blocking<F, R>(f: F) -> JoinHandle<R>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        tokio::task::spawn_blocking(f)
    }
}
