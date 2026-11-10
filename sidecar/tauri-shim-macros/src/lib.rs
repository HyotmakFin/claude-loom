use proc_macro::TokenStream;

/// No-op replacement for `#[tauri::command]` in the sidecar build.
#[proc_macro_attribute]
pub fn command(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
