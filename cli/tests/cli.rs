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
fn init_creates_expected_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let project_dir = temp.path().join("my-stm32-proj");

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.args(["init", "--target", "stm32f042", "--path"])
        .arg(&project_dir);
    cmd.assert().success();

    assert!(project_dir.join(".project").exists());
    assert!(project_dir.join(".cproject").exists());
    assert!(project_dir.join("my-stm32-proj.ioc").exists());
    assert!(project_dir.join("Core/Src/main.c").exists());
    assert!(project_dir.join("USB_DEVICE/App/usbd_midi_if.c").exists());
}

#[test]
fn init_writes_selected_components() {
    let temp = tempfile::tempdir().expect("tempdir");
    let project_dir = temp.path().join("my-stm32-proj");

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.args([
        "init",
        "--target",
        "stm32f042",
        "--path",
        project_dir.to_str().expect("utf8 path"),
        "--components",
        "gpio,cc1101",
    ]);
    cmd.assert().success();

    assert!(project_dir.join("Core/Src/cc1101.c").exists());
}

#[test]
fn init_stm32f042_creates_project_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let project_dir = temp.path().join("my-stm32-proj");

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.args(["init", "--target", "stm32f042", "--path"])
        .arg(&project_dir);
    cmd.assert().success();

    assert!(project_dir.join(".project").exists());
    assert!(project_dir.join(".cproject").exists());
    assert!(project_dir.join("my-stm32-proj.ioc").exists());
    assert!(project_dir.join("Core/Src/main.c").exists());
}

#[test]
fn vibe_init_writes_agents_md() {
    let temp = tempfile::tempdir().expect("tempdir");

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.args(["vibe", "init", "--path"])
        .arg(temp.path())
        .args(["--force"]);
    cmd.assert().success();

    let agents_path = temp.path().join("AGENTS.md");
    assert!(agents_path.exists());

    let agents = std::fs::read_to_string(agents_path).expect("read agents");
    assert!(agents.contains("## Vibe Hacking"));
    assert!(agents.contains("emw.send("));
}
