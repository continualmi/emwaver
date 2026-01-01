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

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.args(["init", "--target", "esp32s3", "--path"])
        .arg(temp.path());
    cmd.assert().success();

    assert!(temp.path().join("CMakeLists.txt").exists());
    assert!(temp.path().join("sdkconfig").exists());
    assert!(temp.path().join("setup.sh").exists());
    assert!(temp.path().join("main").join("idf_component.yml").exists());
    assert!(temp.path().join("main").join("ble_server.c").exists());
    assert!(temp.path().join("main").join("command_registry.c").exists());
    assert!(temp.path().join("main").join("main.c").exists());
    assert!(temp.path().join("main").join("init.c").exists());
}

#[test]
fn init_writes_selected_components() {
    let temp = tempfile::tempdir().expect("tempdir");

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.args([
        "init",
        "--target",
        "esp32s3",
        "--path",
        temp.path().to_str().expect("utf8 path"),
        "--components",
        "gpio,cc1101",
    ]);
    cmd.assert().success();

    assert!(temp.path().join("main").join("gpio_commands.c").exists());
    assert!(temp.path().join("main").join("cc1101.c").exists());
    assert!(temp.path().join("main").join("spi.c").exists());
    assert!(temp.path().join("main").join("spi.h").exists());
}

#[test]
fn init_stm32f042_creates_project_files() {
    let temp = tempfile::tempdir().expect("tempdir");
    let project_dir = temp.path().join("my-stm32-proj");

    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.args(["init", "--target", "stm32f042", "--path"])
        .arg(&project_dir)
        .args(["--stm32-firmware", "ism"]);
    cmd.assert().success();

    assert!(project_dir.join(".project").exists());
    assert!(project_dir.join(".cproject").exists());
    assert!(project_dir.join("my-stm32-proj.ioc").exists());
    assert!(project_dir.join("Core/Src/main.c").exists());
}
