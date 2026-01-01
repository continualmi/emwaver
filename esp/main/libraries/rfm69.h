#pragma once

#include <stdint.h>
#include <stdbool.h>

// Register definitions
#define REG_FIFO          0x00
#define REG_OPMODE        0x01
#define REG_DATAMODUL     0x02
#define REG_BITRATEMSB    0x03
#define REG_BITRATELSB    0x04
#define REG_FDEVMSB       0x05
#define REG_FDEVLSB       0x06
#define REG_FRFMSB        0x07
#define REG_FRFMID        0x08
#define REG_FRFLSB        0x09
#define REG_OSC1          0x0A
#define REG_AFCCTRL       0x0B
#define REG_LOWBAT        0x0C
#define REG_LISTEN1       0x0D
#define REG_LISTEN2       0x0E
#define REG_LISTEN3       0x0F
#define REG_VERSION       0x10
#define REG_PALEVEL       0x11
#define REG_PARAMP        0x12
#define REG_OCP           0x13
#define REG_LNA           0x18
#define REG_RXBW          0x19
#define REG_AFCBW         0x1A
#define REG_OOKPEAK       0x1B
#define REG_OOKAVG        0x1C
#define REG_OOKFIX        0x1D
#define REG_AFCFEI        0x1E
#define REG_AFCMSB        0x1F
#define REG_AFCLSB        0x20
#define REG_FEIMSB        0x21
#define REG_FEILSB        0x22
#define REG_RSSICONFIG    0x23
#define REG_RSSIVALUE     0x24
#define REG_DIOMAPPING1   0x25
#define REG_DIOMAPPING2   0x26
#define REG_IRQFLAGS1     0x27
#define REG_IRQFLAGS2     0x28
#define REG_RSSITHRESH    0x29
#define REG_RXTIMEOUT1    0x2A
#define REG_RXTIMEOUT2    0x2B
#define REG_PREAMBLEMSB   0x2C
#define REG_PREAMBLELSB   0x2D
#define REG_SYNCCONFIG    0x2E
#define REG_SYNCVALUE1    0x2F
#define REG_PACKETCONFIG1 0x37
#define REG_PAYLOADLENGTH 0x38
#define REG_NODEADRS      0x39
#define REG_BROADCASTADRS 0x3A
#define REG_AUTOMODES     0x3B
#define REG_FIFOTHRESH    0x3C
#define REG_PACKETCONFIG2 0x3D
#define REG_TEMP1         0x4E
#define REG_TEMP2         0x4F
#define REG_TESTLNA       0x58
#define REG_TESTPA1       0x5A
#define REG_TESTPA2       0x5C
#define REG_TESTDAGC      0x6F

// OpMode bits
#define RF_OPMODE_SEQUENCER_OFF 0x80
#define RF_OPMODE_SEQUENCER_ON  0x00
#define RF_OPMODE_LISTEN_ON     0x40
#define RF_OPMODE_LISTEN_OFF    0x00
#define RF_OPMODE_LISTENABORT   0x20
#define RF_OPMODE_SLEEP         0x00
#define RF_OPMODE_STANDBY       0x04
#define RF_OPMODE_SYNTHESIZER   0x08
#define RF_OPMODE_TRANSMITTER   0x0C
#define RF_OPMODE_RECEIVER      0x10

// DataModul bits
#define RF_DATAMODUL_DATAMODE_PACKET             0x00
#define RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC  0x40
#define RF_DATAMODUL_DATAMODE_CONTINUOUS         0x60
#define RF_DATAMODUL_MODULATIONTYPE_FSK          0x00
#define RF_DATAMODUL_MODULATIONTYPE_OOK          0x08
#define RF_DATAMODUL_MODULATIONSHAPING_00        0x00

// PaLevel bits
#define RF_PALEVEL_PA0_ON  0x80
#define RF_PALEVEL_PA0_OFF 0x00
#define RF_PALEVEL_PA1_ON  0x40
#define RF_PALEVEL_PA1_OFF 0x00
#define RF_PALEVEL_PA2_ON  0x20
#define RF_PALEVEL_PA2_OFF 0x00

// OCP bits
#define RF_OCP_ON  0x1A
#define RF_OCP_OFF 0x0F

// LNA bits
#define RF_LNA_ZIN_50                   0x00
#define RF_LNA_ZIN_200                  0x80
#define RF_LNA_GAINSELECT_AUTO          0x00
#define RF_LNA_GAINSELECT_MAX           0x08
#define RF_LNA_GAINSELECT_MAXMINUS6     0x10
#define RF_LNA_GAINSELECT_MAXMINUS12    0x18
#define RF_LNA_GAINSELECT_MAXMINUS24    0x20
#define RF_LNA_GAINSELECT_MAXMINUS36    0x28
#define RF_LNA_GAINSELECT_MAXMINUS48    0x30

// OokPeak bits
#define RF_OOKPEAK_THRESHTYPE_FIXED       0x00
#define RF_OOKPEAK_THRESHTYPE_PEAK        0x40
#define RF_OOKPEAK_PEAKTHRESHSTEP_000     0x00
#define RF_OOKPEAK_PEAKTHRESHDEC_000      0x00

// RSSI Config bits
#define RF_RSSI_START 0x01
#define RF_RSSI_DONE  0x02

// IrqFlags1 bits
#define RF_IRQFLAGS1_MODEREADY 0x80

// Modes (High level)
#define MODE_SLEEP   0
#define MODE_STANDBY 1
#define MODE_SYNTH   2
#define MODE_RX      3
#define MODE_TX      4

// Modulation types
#define MOD_FSK 0
#define MOD_OOK 1

// PA modes
#define PA_MODE_PA0            1
#define PA_MODE_PA1            2
#define PA_MODE_PA1_PA2        3
#define PA_MODE_PA1_PA2_20DBM  4

// Functions
void rfm69_register_commands(void);
// NOTE: `rfm69_init_device()` is intentionally internal to `rfm69.c`.
