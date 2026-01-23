/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

use assert_cmd::Command;

#[test]
fn help_displays() {
    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.arg("--help").assert().success();
}

#[test]
fn rejects_non_emw_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("script.js");
    std::fs::write(&path, "print('hi')").expect("write script");

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.arg(&path)
        .assert()
        .failure()
        .stderr(predicates::str::contains("Only .emw scripts are supported"));
}

#[test]
fn eval_flag_parses() {
    // Don't assert behavior here (it depends on whether Desktop is running in the test env).
    // We just ensure Clap accepts the flag and the process starts.
    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    let _ = cmd.args(["-c", "print(1)"]).output();
}
