//! Headless checks for the SVM lab. `cargo run -p svm-cli -- run counter`.

use std::process::ExitCode;

use svm_core::scenario::Scenario;

fn usage() -> &'static str {
    "usage:\n  svm-lab run [program] [--json]\n  svm-lab verify [program] [--fault NAME]\n  svm-lab layout\n  svm-lab programs"
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first().map(String::as_str) else {
        println!("{}", usage());
        return ExitCode::SUCCESS;
    };

    match command {
        "run" => {
            let program = args.get(1).cloned().unwrap_or_else(|| "counter".into());
            let json = args.iter().any(|a| a == "--json");
            let scenario = Scenario {
                program,
                ..Default::default()
            };
            match svm_core::run_json(&scenario.to_json()) {
                Ok(run) if json => {
                    println!("{run}");
                    ExitCode::SUCCESS
                }
                Ok(run) => {
                    let value: serde_json::Value = serde_json::from_str(&run).unwrap();
                    println!("{}", value["summary"].as_str().unwrap_or(""));
                    println!(
                        "  result: {} ({})",
                        value["result"]["code"].as_str().unwrap_or("?"),
                        value["result"]["message"].as_str().unwrap_or("")
                    );
                    println!(
                        "  cu: {} / {}",
                        value["cu_used"], value["cu_limit"]
                    );
                    println!("  steps: {}", value["steps_total"]);
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::FAILURE
                }
            }
        }
        "verify" => {
            let program = args.get(1).cloned().unwrap_or_else(|| "counter".into());
            let fault = args
                .iter()
                .position(|a| a == "--fault")
                .and_then(|i| args.get(i + 1))
                .cloned();
            let scenario = Scenario {
                program,
                fault,
                ..Default::default()
            };
            match svm_core::verify_json(&scenario.to_json()) {
                Ok(json) => {
                    let checks: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
                    for check in checks {
                        println!(
                            "  {} {:<10} {}",
                            if check["ok"].as_bool().unwrap_or(false) {
                                "ok"
                            } else {
                                "FAIL"
                            },
                            check["id"].as_str().unwrap_or(""),
                            check["label"].as_str().unwrap_or("")
                        );
                    }
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::FAILURE
                }
            }
        }
        "layout" => {
            println!("{}", svm_core::layout_json("aligned"));
            ExitCode::SUCCESS
        }
        "programs" => {
            println!("{}", svm_core::programs_json());
            ExitCode::SUCCESS
        }
        other => {
            eprintln!("unknown command '{other}'\n{}", usage());
            ExitCode::FAILURE
        }
    }
}
