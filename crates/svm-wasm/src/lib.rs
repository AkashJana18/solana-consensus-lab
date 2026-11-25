//! WebAssembly bridge for the SVM lab. The UI only ever sees JSON.

use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = svmRun)]
pub fn svm_run(scenario_json: &str) -> Result<String, JsError> {
    svm_core::run_json(scenario_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = svmVerify)]
pub fn svm_verify(scenario_json: &str) -> Result<String, JsError> {
    svm_core::verify_json(scenario_json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = svmLayout)]
pub fn svm_layout(mode: &str) -> String {
    svm_core::layout_json(mode)
}

#[wasm_bindgen(js_name = svmPrograms)]
pub fn svm_programs() -> String {
    svm_core::programs_json()
}
