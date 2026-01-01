/*
 * EMWaver CLI
 * Copyright (C) 2025 Luís Marnoto
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use include_dir::{include_dir, Dir};

use crate::cli::{Component, Stm32Firmware, Target};

static ESP32S3_TEMPLATE: Dir = include_dir!("$CARGO_MANIFEST_DIR/../esp");
static STM32F042_GPIO_TEMPLATE: Dir = include_dir!("$CARGO_MANIFEST_DIR/../stm/emwaver-gpio-firmware");
static STM32F042_IR_TEMPLATE: Dir = include_dir!("$CARGO_MANIFEST_DIR/../stm/emwaver-ir-firmware");
static STM32F042_ISM_TEMPLATE: Dir = include_dir!("$CARGO_MANIFEST_DIR/../stm/emwaver-ism-firmware");
static STM32F042_RFID_TEMPLATE: Dir = include_dir!("$CARGO_MANIFEST_DIR/../stm/emwaver-rfid-firmware");

pub fn run_init(
    target: Target,
    components: Vec<Component>,
    stm32_firmware: Option<Stm32Firmware>,
    destination: PathBuf,
) -> Result<()> {
    let component_set: HashSet<Component> = components.into_iter().collect();

    if destination.exists() {
        if !destination.is_dir() {
            bail!("destination exists and is not a directory");
        }
    } else {
        fs::create_dir_all(&destination)
            .with_context(|| format!("failed to create {}", destination.display()))?;
    }

    match target {
        Target::Esp32s3 => write_esp32s3(&destination, &component_set),
        Target::Stm32f042 => write_stm32f042(&destination, &component_set, stm32_firmware),
    }?;

    println!("Initialized {target:?} project at {}", destination.display());
    match target {
        Target::Esp32s3 => println!("Next: `cd {}` then `source setup.sh`.", destination.display()),
        Target::Stm32f042 => {
            let project_name = destination
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("emwaver-gpio-firmware");
            println!("Next: open `{project_name}.ioc` in STM32CubeIDE, generate code if prompted, then build/flash.");
        }
    }
    Ok(())
}

fn write_esp32s3(destination: &Path, components: &HashSet<Component>) -> Result<()> {
    write_template_file("CMakeLists.txt", destination)?;
    write_template_file("sdkconfig", destination)?;
    write_template_file("sdkconfig.ci", destination)?;
    write_template_file("partitions_ota_4mb.csv", destination)?;
    write_template_file("dependencies.lock", destination)?;
    write_template_file("setup.sh", destination)?;
    write_template_file("main/idf_component.yml", destination)?;

    write_template_file("main/libraries/ble_server.c", destination)?;
    write_template_file("main/libraries/ble_server.h", destination)?;
    write_template_file("main/libraries/command_registry.c", destination)?;
    write_template_file("main/libraries/command_registry.h", destination)?;
    write_template_file("main/main.h", destination)?;
    if components.contains(&Component::Ota) {
        write_template_file("main/libraries/ota_ble.c", destination)?;
        write_template_file("main/libraries/ota_ble.h", destination)?;
        write_template_file("main/libraries/ota_ble_gatt.c", destination)?;
        write_template_file("main/libraries/ota_ble_gatt.h", destination)?;
        write_template_file("main/libraries/ota_core.c", destination)?;
        write_template_file("main/libraries/ota_core.h", destination)?;
        write_template_file("main/libraries/ota_status.c", destination)?;
        write_template_file("main/libraries/ota_status.h", destination)?;
        write_template_file("main/libraries/ota_wifi.c", destination)?;
        write_template_file("main/libraries/ota_wifi.h", destination)?;
    }

    if components.contains(&Component::Gpio) {
        write_template_file("main/libraries/gpio_commands.c", destination)?;
        write_template_file("main/libraries/gpio_commands.h", destination)?;
    }
    if components.contains(&Component::Sampler) {
        write_template_file("main/libraries/sampler.c", destination)?;
        write_template_file("main/libraries/sampler.h", destination)?;
    }
    if components.contains(&Component::Cc1101) {
        write_template_file("main/libraries/spi.c", destination)?;
        write_template_file("main/libraries/spi.h", destination)?;
        write_template_file("main/libraries/cc1101.c", destination)?;
        write_template_file("main/libraries/cc1101.h", destination)?;
    }
    if components.contains(&Component::Rfm69) {
        write_template_file("main/libraries/spi.c", destination)?;
        write_template_file("main/libraries/spi.h", destination)?;
        write_template_file("main/libraries/rfm69.c", destination)?;
        write_template_file("main/libraries/rfm69.h", destination)?;
    }
    if components.contains(&Component::Mfrc522) {
        write_template_file("main/libraries/spi.c", destination)?;
        write_template_file("main/libraries/spi.h", destination)?;
        write_template_file("main/libraries/mfrc522.c", destination)?;
        write_template_file("main/libraries/mfrc522.h", destination)?;
    }

    write_generated_main(destination)?;
    write_generated_init(destination, components)?;
    write_generated_component_cmake(destination, components)?;

    Ok(())
}

fn write_stm32f042(
    destination: &Path,
    components: &HashSet<Component>,
    stm32_firmware: Option<Stm32Firmware>,
) -> Result<()> {
    if components.contains(&Component::Rfm69) {
        bail!("stm32f042 target does not support rfm69 yet");
    }

    let firmware = stm32_firmware.unwrap_or_else(|| derive_stm32_firmware(components));
    let (template, template_name, template_ioc_filename) = stm32_template(firmware);

    write_dir_recursive(template, destination)?;

    let project_name = destination
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(template_name);

    rename_and_rewrite_stm32_project_files(destination, template_name, template_ioc_filename, project_name)?;
    Ok(())
}

fn write_template_file(path: &str, destination: &Path) -> Result<()> {
    let file = ESP32S3_TEMPLATE
        .get_file(path)
        .with_context(|| format!("missing template file: {path}"))?;
    let target = destination.join(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    fs::write(&target, file.contents())
        .with_context(|| format!("failed to write {}", target.display()))?;

    #[cfg(unix)]
    make_executable_if_shell_script(&target)?;

    Ok(())
}

#[cfg(unix)]
fn make_executable_if_shell_script(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    if path.extension().and_then(|ext| ext.to_str()) != Some("sh") {
        return Ok(());
    }
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

fn write_dir_recursive(source: &Dir, destination: &Path) -> Result<()> {
    for entry in source.find("**/*").into_iter().flatten() {
        let Some(file) = entry.as_file() else {
            continue;
        };
        let relative = file.path();
        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        fs::write(&target, file.contents())
            .with_context(|| format!("failed to write {}", target.display()))?;
    }
    Ok(())
}

fn derive_stm32_firmware(components: &HashSet<Component>) -> Stm32Firmware {
    if components.contains(&Component::Cc1101) {
        return Stm32Firmware::Ism;
    }
    if components.contains(&Component::Sampler) {
        return Stm32Firmware::Ir;
    }
    if components.contains(&Component::Mfrc522) {
        return Stm32Firmware::Rfid;
    }
    Stm32Firmware::Gpio
}

fn stm32_template(firmware: Stm32Firmware) -> (&'static Dir<'static>, &'static str, &'static str) {
    match firmware {
        Stm32Firmware::Gpio => (&STM32F042_GPIO_TEMPLATE, "emwaver-gpio-firmware", "emwaver-gpio-firmware.ioc"),
        Stm32Firmware::Ir => (&STM32F042_IR_TEMPLATE, "emwaver-ir-firmware", "emwaver-ir-firmware.ioc"),
        // ISM template still uses the legacy internal project name "emwaver-firmware".
        Stm32Firmware::Ism => (&STM32F042_ISM_TEMPLATE, "emwaver-firmware", "emwaver-firmware.ioc"),
        Stm32Firmware::Rfid => (
            &STM32F042_RFID_TEMPLATE,
            "emwaver-rfid-firmware",
            "emwaver-rfid-firmware.ioc",
        ),
    }
}

fn rename_and_rewrite_stm32_project_files(
    destination: &Path,
    template_name: &str,
    template_ioc_filename: &str,
    project_name: &str,
) -> Result<()> {

    let project_path = destination.join(".project");
    if project_path.exists() {
        let contents = fs::read_to_string(&project_path)?;
        let updated = contents.replace(&format!("<name>{template_name}</name>"), &format!("<name>{project_name}</name>"));
        fs::write(&project_path, updated)?;
    }

    let cproject_path = destination.join(".cproject");
    if cproject_path.exists() {
        let contents = fs::read_to_string(&cproject_path)?;
        let updated = contents.replace(template_name, project_name);
        fs::write(&cproject_path, updated)?;
    }

    let old_ioc_path = destination.join(template_ioc_filename);
    let new_ioc_path = destination.join(format!("{project_name}.ioc"));
    let ioc_path = if old_ioc_path.exists() {
        fs::rename(&old_ioc_path, &new_ioc_path)?;
        new_ioc_path
    } else {
        new_ioc_path
    };

    if ioc_path.exists() {
        let contents = fs::read_to_string(&ioc_path)?;
        let updated = contents
            .replace(&format!("ProjectManager.ProjectName={template_name}"), &format!("ProjectManager.ProjectName={project_name}"))
            .replace(
                &format!("ProjectManager.ProjectFileName={template_ioc_filename}"),
                &format!("ProjectManager.ProjectFileName={project_name}.ioc"),
            )
            .replace(template_name, project_name);
        fs::write(&ioc_path, updated)?;
    }

    patch_text_file(destination, "README.md", template_name, project_name, template_ioc_filename)?;
    patch_text_file(
        destination,
        "build_android_asset.sh",
        template_name,
        project_name,
        template_ioc_filename,
    )?;

    Ok(())
}

fn patch_text_file(
    destination: &Path,
    relative_path: &str,
    template_name: &str,
    project_name: &str,
    template_ioc_filename: &str,
) -> Result<()> {
    let path = destination.join(relative_path);
    if !path.exists() {
        return Ok(());
    }
    let contents = fs::read_to_string(&path)?;
    let updated = contents
        .replace(template_name, project_name)
        .replace(template_ioc_filename, &format!("{project_name}.ioc"));
    if updated != contents {
        fs::write(&path, updated)?;
    }
    Ok(())
}

#[allow(dead_code)]
fn patch_stm32_main(destination: &Path, components: &HashSet<Component>) -> Result<()> {
    let main_path = destination.join("Core/Src/main.c");
    if !main_path.exists() {
        bail!("stm32f042 template missing Core/Src/main.c");
    }

    let contents = fs::read_to_string(&main_path)?;

    let includes = {
        let mut lines = vec![
            "#include <stdio.h>",
            "#include <stdlib.h>",
            "#include \"usbd_cdc_if.h\"",
            "#include \"command_registry.h\"",
        ];
        if components.contains(&Component::Cc1101) {
            lines.push("#include \"cc1101.h\"");
        }
        if components.contains(&Component::Gpio) {
            lines.push("#include \"stm_gpio.h\"");
        }
        if components.contains(&Component::Sampler) {
            lines.push("#include \"stm_sampler.h\"");
        }
        if components.contains(&Component::Mfrc522) {
            lines.push("#include \"MFRC522.h\"");
        }
        lines.join("\n")
    };

    let init_calls = {
        let mut lines = vec!["  command_registry_init();"];
        if components.contains(&Component::Cc1101) {
            lines.push("  cc1101_register_commands();");
        }
        if components.contains(&Component::Gpio) {
            lines.push("  stm_gpio_register_commands();");
        }
        if components.contains(&Component::Sampler) {
            lines.push("  stm_sampler_register_commands();");
        }
        if components.contains(&Component::Mfrc522) {
            lines.push("  mfrc522_register_commands();");
        }
        lines.push("  stm_register_commands();");
        lines.join("\n")
    };

    let updated = replace_between_markers(
        &contents,
        "/* USER CODE BEGIN Includes */",
        "/* USER CODE END Includes */",
        &format!("\n{includes}\n"),
    )
    .context("failed to patch USER CODE Includes block")?;

    let updated = replace_between_markers(
        &updated,
        "/* USER CODE BEGIN 2 */",
        "/* USER CODE END 2 */",
        &format!("\n{init_calls}\n"),
    )
    .context("failed to patch USER CODE 2 block")?;

    fs::write(&main_path, updated)?;
    Ok(())
}

#[allow(dead_code)]
fn replace_between_markers(haystack: &str, start: &str, end: &str, replacement: &str) -> Result<String> {
    let start_idx = haystack
        .find(start)
        .ok_or_else(|| anyhow::anyhow!("missing start marker: {start}"))?;
    let after_start = start_idx + start.len();
    let end_idx = haystack[after_start..]
        .find(end)
        .map(|idx| after_start + idx)
        .ok_or_else(|| anyhow::anyhow!("missing end marker: {end}"))?;

    let mut out = String::with_capacity(haystack.len() + replacement.len());
    out.push_str(&haystack[..after_start]);
    out.push_str(replacement);
    out.push_str(&haystack[end_idx..]);
    Ok(out)
}

fn write_generated_main(destination: &Path) -> Result<()> {
    let contents = r#"#include "main.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

void app_main(void)
{
    emwaver_init();
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
"#;
    write_generated_file(destination, "main/main.c", contents)
}

fn write_generated_init(destination: &Path, components: &HashSet<Component>) -> Result<()> {
    let mut includes = vec![
        "#include \"main.h\"",
        "",
        "#include <string.h>",
        "",
        "#include \"ble_server.h\"",
        "#include \"command_registry.h\"",
        "#include \"driver/gpio.h\"",
        "#include \"esp_err.h\"",
        "#include \"esp_heap_caps.h\"",
        "#include \"esp_log.h\"",
        "#include \"sdkconfig.h\"",
        "#include \"freertos/FreeRTOS.h\"",
        "#include \"freertos/queue.h\"",
        "#include \"freertos/task.h\"",
        "#include \"nvs_flash.h\"",
    ];

    if components.contains(&Component::Sampler) {
        includes.push("#include \"sampler.h\"");
    }
    if components.contains(&Component::Cc1101) {
        includes.push("#include \"cc1101.h\"");
    }
    if components.contains(&Component::Rfm69) {
        includes.push("#include \"rfm69.h\"");
    }
    if components.contains(&Component::Gpio) {
        includes.push("#include \"gpio_commands.h\"");
    }

    let mut lines = Vec::new();
    lines.push("/*".to_string());
    lines.push(" * EMWaver Firmware - Initialization".to_string());
    lines.push(" * Copyright (C) 2025 Luís Marnoto".to_string());
    lines.push(" *".to_string());
    lines.push(" * This program is free software: you can redistribute it and/or modify".to_string());
    lines.push(" * it under the terms of the GNU General Public License as published by".to_string());
    lines.push(" * the Free Software Foundation, either version 3 of the License, or".to_string());
    lines.push(" * (at your option) any later version.".to_string());
    lines.push(" *".to_string());
    lines.push(" * This program is distributed in the hope that it will be useful,".to_string());
    lines.push(" * but WITHOUT ANY WARRANTY; without even the implied warranty of".to_string());
    lines.push(" * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the".to_string());
    lines.push(" * GNU General Public License for more details.".to_string());
    lines.push(" *".to_string());
    lines.push(" * You should have received a copy of the GNU General Public License".to_string());
    lines.push(" * along with this program.  If not, see <https://www.gnu.org/licenses/>.".to_string());
    lines.push(" */".to_string());
    lines.push("".to_string());
    lines.extend(includes.iter().map(|line| line.to_string()));
    lines.push("".to_string());
    lines.push("#define FIRMWARE_VERSION \"1.0.0\"".to_string());
    lines.push("#define CMD_QUEUE_LEN 10".to_string());
    lines.push("#define STARTUP_LED GPIO_NUM_1".to_string());
    lines.push("#define IR_TX_PIN GPIO_NUM_37".to_string());
    lines.push("".to_string());
    lines.push("static const char *TAG = \"INIT\";".to_string());
    lines.push("static QueueHandle_t cmd_queue;".to_string());
    lines.push("static TaskHandle_t command_task_handle;".to_string());
    lines.push("".to_string());
    lines.push("static void command_task(void *pv_parameters);".to_string());
    lines.push("static void register_core_commands(void);".to_string());
    lines.push("static void version_command(void);".to_string());
    lines.push("".to_string());
    lines.push("void emwaver_init(void)".to_string());
    lines.push("{".to_string());
    lines.push("    gpio_reset_pin(IR_TX_PIN);".to_string());
    lines.push("    gpio_set_direction(IR_TX_PIN, GPIO_MODE_OUTPUT);".to_string());
    lines.push("    gpio_set_level(IR_TX_PIN, 0);".to_string());
    lines.push("".to_string());
    lines.push("    esp_err_t ret = nvs_flash_init();".to_string());
    lines.push("    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {".to_string());
    lines.push("        ESP_ERROR_CHECK(nvs_flash_erase());".to_string());
    lines.push("        ret = nvs_flash_init();".to_string());
    lines.push("    }".to_string());
    lines.push("    ESP_ERROR_CHECK(ret);".to_string());
    lines.push("".to_string());
    lines.push("    gpio_config_t io_conf = {".to_string());
    lines.push("        .pin_bit_mask = 1ULL << STARTUP_LED,".to_string());
    lines.push("        .mode = GPIO_MODE_OUTPUT,".to_string());
    lines.push("        .pull_up_en = GPIO_PULLUP_DISABLE,".to_string());
    lines.push("        .pull_down_en = GPIO_PULLDOWN_DISABLE,".to_string());
    lines.push("        .intr_type = GPIO_INTR_DISABLE,".to_string());
    lines.push("    };".to_string());
    lines.push("    gpio_config(&io_conf);".to_string());
    lines.push("    for (int i = 0; i < 3; ++i) {".to_string());
    lines.push("        gpio_set_level(STARTUP_LED, 1);".to_string());
    lines.push("        vTaskDelay(pdMS_TO_TICKS(200));".to_string());
    lines.push("        gpio_set_level(STARTUP_LED, 0);".to_string());
    lines.push("        vTaskDelay(pdMS_TO_TICKS(200));".to_string());
    lines.push("    }".to_string());
    lines.push("".to_string());
    lines.push("    command_registry_init();".to_string());
    if components.contains(&Component::Sampler) {
        lines.push("    sampler_module_init();".to_string());
    }
    lines.push("".to_string());
    if components.contains(&Component::Gpio) {
        lines.push("    gpio_register_commands();".to_string());
    }
    if components.contains(&Component::Sampler) {
        lines.push("    sampler_register_commands();".to_string());
    }
    if components.contains(&Component::Cc1101) {
        lines.push("    cc1101_register_commands();".to_string());
    }
    if components.contains(&Component::Rfm69) {
        lines.push("    rfm69_register_commands();".to_string());
    }
    lines.push("    register_core_commands();".to_string());
    lines.push("".to_string());
    lines.push("    cmd_queue = xQueueCreate(CMD_QUEUE_LEN, sizeof(command_t));".to_string());
    lines.push("    configASSERT(cmd_queue != NULL);".to_string());
    lines.push("".to_string());
    lines.push("    ble_server_init(cmd_queue);".to_string());
    lines.push("".to_string());
    lines.push("    BaseType_t created = xTaskCreatePinnedToCore(command_task,".to_string());
    lines.push("                                                \"cmd_task\",".to_string());
    lines.push("                                                8192,".to_string());
    lines.push("                                                NULL,".to_string());
    lines.push("                                                5,".to_string());
    lines.push("                                                &command_task_handle,".to_string());
    lines.push("                                                APP_CPU_NUM);".to_string());
    lines.push("    configASSERT(created == pdPASS);".to_string());
    lines.push("".to_string());
    lines.push("    ESP_LOGI(TAG, \"Firmware initialized. Free heap: %u bytes\",".to_string());
    lines.push("             (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT));".to_string());
    lines.push("}".to_string());
    lines.push("".to_string());
    lines.push("static void command_task(void *pv_parameters)".to_string());
    lines.push("{".to_string());
    lines.push("    (void)pv_parameters;".to_string());
    lines.push("    command_t cmd;".to_string());
    lines.push("".to_string());
    lines.push("    for (;;) {".to_string());
    lines.push("        if (xQueueReceive(cmd_queue, &cmd, portMAX_DELAY) == pdTRUE) {".to_string());
    lines.push("            if (cmd.length == 0) {".to_string());
    lines.push("                continue;".to_string());
    lines.push("            }".to_string());
    lines.push("            if (!command_registry_is_ascii(&cmd)) {".to_string());
    lines.push("                command_send_err(\"binary unsupported\");".to_string());
    lines.push("                continue;".to_string());
    lines.push("            }".to_string());
    lines.push("            command_registry_handle(&cmd);".to_string());
    lines.push("        }".to_string());
    lines.push("    }".to_string());
    lines.push("}".to_string());
    lines.push("".to_string());
    lines.push("static void register_core_commands(void)".to_string());
    lines.push("{".to_string());
    lines.push("    bool ok = true;".to_string());
    lines.push("    ok &= register_command(".to_string());
    lines.push("        \"version\",".to_string());
    lines.push("        (void *)version_command,".to_string());
    lines.push("        (const cmd_arg_spec_t[]){".to_string());
    lines.push("            {NULL, CMD_ARG_DONE, false},".to_string());
    lines.push("        });".to_string());
    lines.push("".to_string());
    lines.push("    if (!ok) {".to_string());
    lines.push("        ESP_LOGE(TAG, \"Failed to register core commands\");".to_string());
    lines.push("    }".to_string());
    lines.push("}".to_string());
    lines.push("".to_string());
    lines.push("static void version_command(void)".to_string());
    lines.push("{".to_string());
    lines.push("    ble_server_notify((const uint8_t *)FIRMWARE_VERSION, strlen(FIRMWARE_VERSION));".to_string());
    lines.push("}".to_string());
    lines.push("".to_string());

    let contents = lines.join("\n");
    write_generated_file(destination, "main/libraries/init.c", &contents)
}

fn write_generated_component_cmake(
    destination: &Path,
    components: &HashSet<Component>,
) -> Result<()> {
    let ota_enabled = components.contains(&Component::Ota);
    let mut sources = vec![
        "main.c",
        "libraries/init.c",
        "libraries/ble_server.c",
        "libraries/command_registry.c",
    ];
    if ota_enabled {
        sources.push("libraries/ota_ble.c");
        sources.push("libraries/ota_ble_gatt.c");
        sources.push("libraries/ota_core.c");
        sources.push("libraries/ota_status.c");
        sources.push("libraries/ota_wifi.c");
    }
    if components.contains(&Component::Gpio) {
        sources.push("libraries/gpio_commands.c");
    }
    if components.contains(&Component::Sampler) {
        sources.push("libraries/sampler.c");
    }
    if components.contains(&Component::Cc1101) {
        sources.push("libraries/cc1101.c");
    }
    if components.contains(&Component::Rfm69) {
        sources.push("libraries/rfm69.c");
    }
    if components.contains(&Component::Mfrc522) {
        sources.push("libraries/mfrc522.c");
    }

    let mut cmake = String::from("idf_component_register(SRCS");
    for src in sources {
        cmake.push(' ');
        cmake.push('"');
        cmake.push_str(src);
        cmake.push('"');
    }
    cmake.push_str(" INCLUDE_DIRS \".\" \"libraries\")\n");
    cmake.push_str(&format!(
        "target_compile_definitions(${{COMPONENT_LIB}} PRIVATE EMWAVER_ENABLE_OTA={})\n",
        if ota_enabled { 1 } else { 0 }
    ));
    write_generated_file(destination, "main/CMakeLists.txt", &cmake)
}

fn write_generated_file(destination: &Path, path: &str, contents: &str) -> Result<()> {
    let target = destination.join(PathBuf::from(path));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    fs::write(&target, contents.as_bytes())
        .with_context(|| format!("failed to write {}", target.display()))?;
    Ok(())
}
