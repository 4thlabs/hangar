//! Prints the OpenAPI document of the contract, which `cargo quoll gen` writes to `web/openapi.json`.

fn main() {
    println!("{}", hangar_api::Api::openapi().to_json_pretty());
}
