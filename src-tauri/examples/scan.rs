//! Scans a folder from the command line and prints the result as JSON, for
//! benchmarking the scanner without the UI: `cargo run --release --example scan -- <folder>`.

use std::path::PathBuf;

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| ".".into());
    let cache = std::env::temp_dir().join("rva-scan-cache");
    match rva_lib::scanner::scan(&PathBuf::from(path), Some(&cache)) {
        Ok(result) => {
            eprintln!("{:?}", result.stats);
            println!("{}", serde_json::to_string(&result).unwrap());
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
