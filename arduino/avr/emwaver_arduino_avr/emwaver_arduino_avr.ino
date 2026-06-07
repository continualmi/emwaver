#include <Arduino.h>
#include <EEPROM.h>
#include <SPI.h>

#define EMWAVER_FIRMWARE_VERSION_MAJOR 1u
#define EMWAVER_FIRMWARE_VERSION_MINOR 0u
#define EMWAVER_FIRMWARE_VERSION_PATCH 0u

#define EMW_TARGET_BOARD_TYPE "arduino_avr"

#define EMW_RESP_STATUS_OK 0x80u
#define EMW_RESP_STATUS_ERR 0x81u
#define EMW_RESP_STATUS_BUSY 0x82u
#define EMW_RESP_MAX_PAYLOAD 17u

#define EMW_OP_VERSION 0x01u
#define EMW_OP_RESET 0x02u
#define EMW_OP_HELP 0x03u
#define EMW_OP_NAME_GET 0x04u
#define EMW_OP_NAME_SET 0x05u
#define EMW_OP_ENTER_DFU 0x06u
#define EMW_OP_IDENTITY_GET 0x07u
#define EMW_OP_HARDWARE_UID_GET 0x08u
#define EMW_OP_BOARD_GET 0x09u
#define EMW_OP_TRANSPORT_SESSION 0x0Bu

#define EMW_TRANSPORT_SESSION_CONNECT 0x01u
#define EMW_TRANSPORT_SESSION_DISCONNECT 0x02u
#define EMW_TRANSPORT_SESSION_HEARTBEAT 0x03u

#define EMW_OP_GPIO 0x10u
#define EMW_GPIO_IN 0x00u
#define EMW_GPIO_OUT 0x01u
#define EMW_GPIO_READ 0x02u
#define EMW_GPIO_HIGH 0x03u
#define EMW_GPIO_LOW 0x04u
#define EMW_GPIO_PULL 0x05u
#define EMW_GPIO_INFO 0x06u

#define EMW_OP_ADC_READ 0x20u
#define EMW_ADC_SRC_PIN 0x00u

#define EMW_OP_SPI_XFER 0x50u

#define EMW_OP_PWM 0x70u
#define EMW_PWM_FREQ 0x00u
#define EMW_PWM_WRITE 0x01u
#define EMW_PWM_STOP 0x02u

#define EMW_LANE_SIZE 18u
#define EMW_SUPERFRAME_SIZE 36u
#define EMW_SYSEX_SIZE 48u
#define EMW_ENCODED_SIZE 42u

#define EMW_EEPROM_UID_MAGIC_ADDR 0
#define EMW_EEPROM_UID_ADDR 1
#define EMW_EEPROM_UID_MAGIC 0xE7u

static uint8_t g_frame[EMW_SYSEX_SIZE];
static uint8_t g_frame_pos = 0;
static uint8_t g_uid[6];
static uint32_t g_pwm_frequency_hz = 490;

static void send_ok(const uint8_t *payload, uint8_t len);
static void send_err(void);
static void send_status(uint8_t status, const uint8_t *payload, uint8_t len);
static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out);
static bool enqueue_sysex(const uint8_t *sysex);
static void handle_command(const uint8_t *lane);
static void handle_gpio(const uint8_t *lane);
static void handle_adc(const uint8_t *lane);
static void handle_spi(const uint8_t *lane);
static void handle_pwm(const uint8_t *lane);
static uint32_t read_u32_le(const uint8_t *p);
static bool valid_digital_pin(uint8_t pin);
static bool valid_pwm_pin(uint8_t pin);
static bool analog_channel_from_encoded_pin(uint8_t encoded, uint8_t *channel);
static void load_or_create_uid(void);
static void maybe_reset_board(void);

void setup() {
  Serial.begin(115200);
  SPI.begin();
  load_or_create_uid();
}

void loop() {
  while (Serial.available() > 0) {
    uint8_t byte = (uint8_t)Serial.read();

    if (g_frame_pos == 0) {
      if (byte != 0xF0u) {
        continue;
      }
      g_frame[g_frame_pos++] = byte;
      continue;
    }

    g_frame[g_frame_pos++] = byte;
    if (g_frame_pos == EMW_SYSEX_SIZE) {
      enqueue_sysex(g_frame);
      memset(g_frame, 0, sizeof(g_frame));
      g_frame_pos = 0;
    } else if (byte == 0xF0u) {
      g_frame[0] = 0xF0u;
      g_frame_pos = 1;
    }
  }
}

static bool enqueue_sysex(const uint8_t *sysex) {
  if (!sysex) {
    return false;
  }
  if (sysex[0] != 0xF0u || sysex[1] != 0x7Du ||
      sysex[2] != 'E' || sysex[3] != 'M' || sysex[4] != 'W' ||
      sysex[EMW_SYSEX_SIZE - 1u] != 0xF7u) {
    return false;
  }

  uint8_t decoded[EMW_SUPERFRAME_SIZE] = {0};
  if (!decode_payload_7bit_fixed(&sysex[5], decoded)) {
    return false;
  }

  bool cmd_any = false;
  for (uint8_t i = 0; i < EMW_LANE_SIZE; ++i) {
    if (decoded[i] != 0) {
      cmd_any = true;
      break;
    }
  }
  if (cmd_any) {
    handle_command(decoded);
  }
  return true;
}

static void handle_command(const uint8_t *lane) {
  switch (lane[0]) {
    case EMW_OP_VERSION: {
      const uint8_t out[] = {
        EMWAVER_FIRMWARE_VERSION_MAJOR,
        EMWAVER_FIRMWARE_VERSION_MINOR,
        EMWAVER_FIRMWARE_VERSION_PATCH
      };
      send_ok(out, sizeof(out));
      return;
    }
    case EMW_OP_RESET:
      send_ok(NULL, 0);
      delay(25);
      maybe_reset_board();
      return;
    case EMW_OP_HELP: {
      const char help[] = "arduino_avr";
      send_ok((const uint8_t *)help, min((uint8_t)strlen(help), (uint8_t)EMW_RESP_MAX_PAYLOAD));
      return;
    }
    case EMW_OP_NAME_GET: {
      const char name[] = "Arduino AVR";
      send_ok((const uint8_t *)name, min((uint8_t)strlen(name), (uint8_t)EMW_RESP_MAX_PAYLOAD));
      return;
    }
    case EMW_OP_NAME_SET:
      send_ok(NULL, 0);
      return;
    case EMW_OP_ENTER_DFU:
      send_err();
      return;
    case EMW_OP_IDENTITY_GET:
    case EMW_OP_HARDWARE_UID_GET:
      send_ok(g_uid, sizeof(g_uid));
      return;
    case EMW_OP_BOARD_GET:
      send_ok((const uint8_t *)EMW_TARGET_BOARD_TYPE, (uint8_t)strlen(EMW_TARGET_BOARD_TYPE));
      return;
    case EMW_OP_TRANSPORT_SESSION:
      if (lane[1] == EMW_TRANSPORT_SESSION_CONNECT ||
          lane[1] == EMW_TRANSPORT_SESSION_DISCONNECT ||
          lane[1] == EMW_TRANSPORT_SESSION_HEARTBEAT) {
        send_ok(NULL, 0);
      } else {
        send_err();
      }
      return;
    case EMW_OP_GPIO:
      handle_gpio(lane);
      return;
    case EMW_OP_ADC_READ:
      handle_adc(lane);
      return;
    case EMW_OP_SPI_XFER:
      handle_spi(lane);
      return;
    case EMW_OP_PWM:
      handle_pwm(lane);
      return;
    default:
      send_err();
      return;
  }
}

static void handle_gpio(const uint8_t *lane) {
  const uint8_t sub = lane[1];
  const uint8_t pin = lane[2];
  if (!valid_digital_pin(pin)) {
    send_err();
    return;
  }

  switch (sub) {
    case EMW_GPIO_IN:
      pinMode(pin, INPUT);
      send_ok(NULL, 0);
      return;
    case EMW_GPIO_OUT:
      pinMode(pin, OUTPUT);
      send_ok(NULL, 0);
      return;
    case EMW_GPIO_PULL: {
      const uint8_t pull = lane[3];
      if (pull == 0u) {
        pinMode(pin, INPUT);
      } else if (pull == 1u) {
        pinMode(pin, INPUT_PULLUP);
      } else {
        send_err();
        return;
      }
      send_ok(NULL, 0);
      return;
    }
    case EMW_GPIO_READ: {
      pinMode(pin, INPUT);
      const uint8_t out = digitalRead(pin) == HIGH ? 1u : 0u;
      send_ok(&out, 1);
      return;
    }
    case EMW_GPIO_HIGH:
    case EMW_GPIO_LOW: {
      pinMode(pin, OUTPUT);
      digitalWrite(pin, sub == EMW_GPIO_HIGH ? HIGH : LOW);
      const uint8_t out = digitalRead(pin) == HIGH ? 1u : 0u;
      send_ok(&out, 1);
      return;
    }
    case EMW_GPIO_INFO: {
      const uint8_t value = digitalRead(pin) == HIGH ? 1u : 0u;
      const uint8_t response[6] = {0, 0, 0, 0, value, value};
      send_ok(response, sizeof(response));
      return;
    }
    default:
      send_err();
      return;
  }
}

static void handle_adc(const uint8_t *lane) {
  const uint8_t src = lane[1];
  const uint8_t pin = lane[2];
  uint8_t samples = lane[3];
  if (src != EMW_ADC_SRC_PIN) {
    send_err();
    return;
  }
  uint8_t channel = 0;
  if (!analog_channel_from_encoded_pin(pin, &channel)) {
    send_err();
    return;
  }
  if (samples < 1u) {
    samples = 1u;
  }
  if (samples > 64u) {
    samples = 64u;
  }

  uint32_t total = 0;
  for (uint8_t i = 0; i < samples; ++i) {
    total += (uint16_t)analogRead(channel);
  }
  const uint16_t avg = (uint16_t)(total / samples);
  const uint8_t out[2] = {(uint8_t)(avg & 0xFFu), (uint8_t)(avg >> 8u)};
  send_ok(out, sizeof(out));
}

static void handle_spi(const uint8_t *lane) {
  const uint8_t cs_pin = lane[1];
  uint8_t rx_req = lane[2];
  uint8_t tx_len = lane[3];
  const uint8_t max_tx = EMW_LANE_SIZE - 4u;
  if (!valid_digital_pin(cs_pin)) {
    send_err();
    return;
  }
  if (tx_len > max_tx) {
    tx_len = max_tx;
  }
  if (rx_req == 0u) {
    rx_req = tx_len;
  }
  if (rx_req > EMW_RESP_MAX_PAYLOAD) {
    rx_req = EMW_RESP_MAX_PAYLOAD;
  }

  const uint8_t xfer_len = max(tx_len, rx_req);
  if (xfer_len == 0u || rx_req == 0u) {
    send_ok(NULL, 0);
    return;
  }

  uint8_t rx[EMW_RESP_MAX_PAYLOAD] = {0};
  pinMode(cs_pin, OUTPUT);
  digitalWrite(cs_pin, HIGH);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(cs_pin, LOW);
  for (uint8_t i = 0; i < xfer_len; ++i) {
    const uint8_t tx = i < tx_len ? lane[4u + i] : 0u;
    const uint8_t got = SPI.transfer(tx);
    if (i < rx_req) {
      rx[i] = got;
    }
  }
  digitalWrite(cs_pin, HIGH);
  SPI.endTransaction();
  send_ok(rx, rx_req);
}

static void handle_pwm(const uint8_t *lane) {
  const uint8_t sub = lane[1];
  if (sub == EMW_PWM_FREQ) {
    const uint32_t hz = read_u32_le(&lane[2]);
    if (hz == 0u) {
      send_err();
      return;
    }
    g_pwm_frequency_hz = hz;
    send_ok(NULL, 0);
    return;
  }

  const uint8_t pin = lane[2];
  if (!valid_pwm_pin(pin)) {
    send_err();
    return;
  }
  if (sub == EMW_PWM_STOP) {
    analogWrite(pin, 0);
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    send_ok(NULL, 0);
    return;
  }
  if (sub == EMW_PWM_WRITE) {
    const uint16_t duty_u12 = (uint16_t)lane[3] | ((uint16_t)lane[4] << 8u);
    const uint8_t duty_u8 = (uint8_t)min(255u, ((uint32_t)duty_u12 * 255u) / 4095u);
    (void)g_pwm_frequency_hz;
    pinMode(pin, OUTPUT);
    analogWrite(pin, duty_u8);
    const uint8_t out = duty_u8;
    send_ok(&out, 1);
    return;
  }
  send_err();
}

static void send_ok(const uint8_t *payload, uint8_t len) {
  send_status(EMW_RESP_STATUS_OK, payload, len);
}

static void send_err(void) {
  send_status(EMW_RESP_STATUS_ERR, NULL, 0);
}

static void send_status(uint8_t status, const uint8_t *payload, uint8_t len) {
  uint8_t frame[EMW_SUPERFRAME_SIZE] = {0};
  uint8_t sysex[EMW_SYSEX_SIZE] = {0};
  frame[0] = status;
  if (payload && len > 0u) {
    if (len > EMW_RESP_MAX_PAYLOAD) {
      len = EMW_RESP_MAX_PAYLOAD;
    }
    memcpy(&frame[1], payload, len);
  }
  sysex[0] = 0xF0u;
  sysex[1] = 0x7Du;
  sysex[2] = 'E';
  sysex[3] = 'M';
  sysex[4] = 'W';
  encode_payload_7bit_fixed(frame, &sysex[5]);
  sysex[EMW_SYSEX_SIZE - 1u] = 0xF7u;
  Serial.write(sysex, sizeof(sysex));
  Serial.flush();
}

static bool decode_payload_7bit_fixed(const uint8_t *in, uint8_t *out) {
  if (!in || !out) {
    return false;
  }
  uint8_t out_index = 0;
  uint8_t in_index = 0;
  while (out_index < EMW_SUPERFRAME_SIZE && in_index < EMW_ENCODED_SIZE) {
    const uint8_t mask = in[in_index++];
    for (uint8_t bit = 0; bit < 7u && out_index < EMW_SUPERFRAME_SIZE && in_index < EMW_ENCODED_SIZE; ++bit) {
      uint8_t value = in[in_index++] & 0x7Fu;
      if ((mask & (1u << bit)) != 0u) {
        value |= 0x80u;
      }
      out[out_index++] = value;
    }
  }
  return out_index == EMW_SUPERFRAME_SIZE;
}

static void encode_payload_7bit_fixed(const uint8_t *in, uint8_t *out) {
  memset(out, 0, EMW_ENCODED_SIZE);
  uint8_t out_index = 0;
  for (uint8_t input_index = 0; input_index < EMW_SUPERFRAME_SIZE && out_index < EMW_ENCODED_SIZE;) {
    uint8_t mask = 0;
    const uint8_t mask_index = out_index++;
    for (uint8_t bit = 0; bit < 7u && input_index < EMW_SUPERFRAME_SIZE && out_index < EMW_ENCODED_SIZE; ++bit) {
      const uint8_t value = in[input_index++];
      if ((value & 0x80u) != 0u) {
        mask |= (uint8_t)(1u << bit);
      }
      out[out_index++] = value & 0x7Fu;
    }
    out[mask_index] = mask;
  }
}

static uint32_t read_u32_le(const uint8_t *p) {
  return (uint32_t)p[0] |
         ((uint32_t)p[1] << 8u) |
         ((uint32_t)p[2] << 16u) |
         ((uint32_t)p[3] << 24u);
}

static bool valid_digital_pin(uint8_t pin) {
  return pin < NUM_DIGITAL_PINS;
}

static bool valid_pwm_pin(uint8_t pin) {
  if (!valid_digital_pin(pin)) {
    return false;
  }
  return digitalPinHasPWM(pin);
}

static bool analog_channel_from_encoded_pin(uint8_t encoded, uint8_t *channel) {
  if (!channel) {
    return false;
  }
  if (encoded < NUM_ANALOG_INPUTS) {
    *channel = encoded;
    return true;
  }
#if defined(A0)
  if (encoded >= A0 && encoded < (A0 + NUM_ANALOG_INPUTS)) {
    *channel = encoded;
    return true;
  }
#endif
  return false;
}

static void load_or_create_uid(void) {
  if (EEPROM.read(EMW_EEPROM_UID_MAGIC_ADDR) == EMW_EEPROM_UID_MAGIC) {
    for (uint8_t i = 0; i < sizeof(g_uid); ++i) {
      g_uid[i] = EEPROM.read(EMW_EEPROM_UID_ADDR + i);
    }
    bool any = false;
    for (uint8_t i = 0; i < sizeof(g_uid); ++i) {
      any = any || g_uid[i] != 0u;
    }
    if (any) {
      return;
    }
  }

  uint32_t seed = micros();
#if defined(A0)
  pinMode(A0, INPUT);
  for (uint8_t i = 0; i < 8; ++i) {
    seed = (seed * 1103515245u) + 12345u + (uint32_t)analogRead(A0);
    delay(2);
  }
#endif
  for (uint8_t i = 0; i < sizeof(g_uid); ++i) {
    seed = (seed * 1664525u) + 1013904223u;
    g_uid[i] = (uint8_t)(seed >> 24u);
    EEPROM.update(EMW_EEPROM_UID_ADDR + i, g_uid[i]);
  }
  EEPROM.update(EMW_EEPROM_UID_MAGIC_ADDR, EMW_EEPROM_UID_MAGIC);
}

static void maybe_reset_board(void) {
#if defined(__AVR__)
  void (*reset_fn)(void) = 0;
  reset_fn();
#endif
}
