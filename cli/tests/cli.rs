use assert_cmd::Command;

#[test]
fn help_displays() {
    let mut cmd = Command::cargo_bin("emwaver").expect("binary exists");
    cmd.arg("--help").assert().success();
}
