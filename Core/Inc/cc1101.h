/*
 * cc1101.h
 *  Created on: 20/04/2023
 *      Author: luispl
 */

#ifndef SRC_CC1101_H_
#define SRC_CC1101_H_

#include "stdint.h"
#include "main.h"

#define CC1101_IOCFG2       0x00        // GDO2 output pin configuration
#define CC1101_IOCFG1       0x01        // GDO1 output pin configuration
#define CC1101_IOCFG0       0x02        // GDO0 output pin configuration
#define CC1101_FIFOTHR      0x03        // RX FIFO and TX FIFO thresholds
#define CC1101_SYNC1        0x04        // Sync word, high INT8U
#define CC1101_SYNC0        0x05        // Sync word, low INT8U
#define CC1101_PKTLEN       0x06        // Packet length
#define CC1101_PKTCTRL1     0x07        // Packet automation control
#define CC1101_PKTCTRL0     0x08        // Packet automation control
#define CC1101_ADDR         0x09        // Device address
#define CC1101_CHANNR       0x0A        // Channel number
#define CC1101_FSCTRL1      0x0B        // Frequency synthesizer control
#define CC1101_FSCTRL0      0x0C        // Frequency synthesizer control
#define CC1101_FREQ2        0x0D        // Frequency control word, high INT8U
#define CC1101_FREQ1        0x0E        // Frequency control word, middle INT8U
#define CC1101_FREQ0        0x0F        // Frequency control word, low INT8U
#define CC1101_MDMCFG4      0x10        // Modem configuration
#define CC1101_MDMCFG3      0x11        // Modem configuration
#define CC1101_MDMCFG2      0x12        // Modem configuration
#define CC1101_MDMCFG1      0x13        // Modem configuration
#define CC1101_MDMCFG0      0x14        // Modem configuration
#define CC1101_DEVIATN      0x15        // Modem deviation setting
#define CC1101_MCSM2        0x16        // Main Radio Control State Machine configuration
#define CC1101_MCSM1        0x17        // Main Radio Control State Machine configuration
#define CC1101_MCSM0        0x18        // Main Radio Control State Machine configuration
#define CC1101_FOCCFG       0x19        // Frequency Offset Compensation configuration
#define CC1101_BSCFG        0x1A        // Bit Synchronization configuration
#define CC1101_AGCCTRL2     0x1B        // AGC control
#define CC1101_AGCCTRL1     0x1C        // AGC control
#define CC1101_AGCCTRL0     0x1D        // AGC control
#define CC1101_WOREVT1      0x1E        // High INT8U Event 0 timeout
#define CC1101_WOREVT0      0x1F        // Low INT8U Event 0 timeout
#define CC1101_WORCTRL      0x20        // Wake On Radio control
#define CC1101_FREND1       0x21        // Front end RX configuration
#define CC1101_FREND0       0x22        // Front end TX configuration
#define CC1101_FSCAL3       0x23        // Frequency synthesizer calibration
#define CC1101_FSCAL2       0x24        // Frequency synthesizer calibration
#define CC1101_FSCAL1       0x25        // Frequency synthesizer calibration
#define CC1101_FSCAL0       0x26        // Frequency synthesizer calibration
#define CC1101_RCCTRL1      0x27        // RC oscillator configuration
#define CC1101_RCCTRL0      0x28        // RC oscillator configuration
#define CC1101_FSTEST       0x29        // Frequency synthesizer calibration control
#define CC1101_PTEST        0x2A        // Production test
#define CC1101_AGCTEST      0x2B        // AGC test
#define CC1101_TEST2        0x2C        // Various test settings
#define CC1101_TEST1        0x2D        // Various test settings
#define CC1101_TEST0        0x2E        // Various test settings

//CC1101 Strobe commands
#define CC1101_SRES         0x30        // Reset chip.
#define CC1101_SFSTXON      0x31        // Enable and calibrate frequency synthesizer (if MCSM0.FS_AUTOCAL=1).
                                        // If in RX/TX: Go to a wait state where only the synthesizer is
                                        // running (for quick RX / TX turnaround).
#define CC1101_SXOFF        0x32        // Turn off crystal oscillator.
#define CC1101_SCAL         0x33        // Calibrate frequency synthesizer and turn it off
                                        // (enables quick start).
#define CC1101_SRX          0x34        // Enable RX. Perform calibration first if coming from IDLE and
                                        // MCSM0.FS_AUTOCAL=1.
#define CC1101_STX          0x35        // In IDLE state: Enable TX. Perform calibration first if
                                        // MCSM0.FS_AUTOCAL=1. If in RX state and CCA is enabled:
                                        // Only go to TX if channel is clear.
#define CC1101_SIDLE        0x36        // Exit RX / TX, turn off frequency synthesizer and exit
                                        // Wake-On-Radio mode if applicable.
#define CC1101_SAFC         0x37        // Perform AFC adjustment of the frequency synthesizer
#define CC1101_SWOR         0x38        // Start automatic RX polling sequence (Wake-on-Radio)
#define CC1101_SPWD         0x39        // Enter power down mode when CSn goes high.
#define CC1101_SFRX         0x3A        // Flush the RX FIFO buffer.
#define CC1101_SFTX         0x3B        // Flush the TX FIFO buffer.
#define CC1101_SWORRST      0x3C        // Reset real time clock.
#define CC1101_SNOP         0x3D        // No operation. May be used to pad strobe commands to two
                                        // INT8Us for simpler software.
//CC1101 STATUS REGSITER
#define CC1101_PARTNUM      0x30
#define CC1101_VERSION      0x31
#define CC1101_FREQEST      0x32
#define CC1101_LQI          0x33
#define CC1101_RSSI         0x34
#define CC1101_MARCSTATE    0x35
#define CC1101_WORTIME1     0x36
#define CC1101_WORTIME0     0x37
#define CC1101_PKTSTATUS    0x38
#define CC1101_VCO_VC_DAC   0x39
#define CC1101_TXuint8_tS      0x3A
#define CC1101_RXuint8_tS      0x3B

//CC1101 PATABLE,TXFIFO,RXFIFO
#define CC1101_PATABLE      0x3E
#define CC1101_TXFIFO       0x3F
#define CC1101_RXFIFO       0x3F


extern SPI_HandleTypeDef hspi1;

 extern uint8_t modulation;
 extern uint8_t frend0;
 extern uint8_t chan;
 extern int pa;
 extern uint8_t last_pa;
 extern uint8_t SCK_PIN;
 extern uint8_t MISO_PIN;
 extern uint8_t MOSI_PIN;
 extern uint8_t SS_PIN;
 extern uint8_t GDO0;
 extern uint8_t GDO2;
 extern uint8_t SCK_PIN_M[6];
 extern uint8_t MISO_PIN_M[6];
 extern uint8_t MOSI_PIN_M[6];
 extern uint8_t SS_PIN_M[6];
 extern uint8_t GDO0_M[6];
 extern uint8_t GDO2_M[6];
 extern uint8_t gdo_set;
 extern uint8_t spi;
 extern uint8_t ccmode;
 extern float MHz;
 extern uint8_t m4RxBw;
 extern uint8_t m4DaRa;
 extern uint8_t m2DCOFF;
 extern uint8_t m2MODFM;
 extern uint8_t m2MANCH;
 extern uint8_t m2SYNCM;
 extern uint8_t m1FEC;
 extern uint8_t m1PRE;
 extern uint8_t m1CHSP;
 extern uint8_t pc1PQT;
 extern uint8_t pc1CRC_AF;
 extern uint8_t pc1APP_ST;
 extern uint8_t pc1ADRCHK;
 extern uint8_t pc0WDATA;
 extern uint8_t pc0PktForm;
 extern uint8_t pc0CRC_EN;
 extern uint8_t pc0LenConf;
 extern uint8_t trxstate;
 extern uint8_t clb1[2];
 extern uint8_t clb2[2];
 extern uint8_t clb3[2];
 extern uint8_t clb4[2];

 /****************************************************************/
 extern uint8_t PA_TABLE[8];
 extern uint8_t PA_TABLE_315[8];             //300 - 348
 extern uint8_t PA_TABLE_433[8];             //387 - 464
 extern uint8_t PA_TABLE_868[10];  //779 - 899.99
 extern uint8_t PA_TABLE_915[10];  //900 - 928



void GDO_Set (void);
void GDO0_Set (void);
void Reset (void);
void setSpi(void);
void RegConfigSettings(void);
void Calibrate(void);
void Split_PKTCTRL0(void);
void Split_PKTCTRL1(void);
void Split_MDMCFG1(void);
void Split_MDMCFG2(void);
void Split_MDMCFG4(void);
void Init(void);
uint8_t SpiReadStatus(uint8_t addr);
void setSpiPin(uint8_t sck, uint8_t miso, uint8_t mosi, uint8_t ss);
void addSpiPin(uint8_t sck, uint8_t miso, uint8_t mosi, uint8_t ss, uint8_t modul);
void setGDO(uint8_t gdo0, uint8_t gdo2);
void setGDO0(uint8_t gdo0);
void addGDO(uint8_t gdo0, uint8_t gdo2, uint8_t modul);
void addGDO0(uint8_t gdo0, uint8_t modul);
void setModul(uint8_t modul);
void setCCMode(uint8_t s);
void setModulation(uint8_t m);
void setPA(int p);
void setMHZ(float mhz);
void setChannel(uint8_t chnl);
void setChsp(float f);
void setRxBW(float f);
void setDRate(float d);
void setDeviation(float d);
void SetTx(void);
void SetRx(void);
int getRssi(void);
uint8_t getLqi(void);
void setSres(void);
void setSidle(void);
void goSleep(void);
uint8_t CheckReceiveFlag(void);
uint8_t ReceiveData(uint8_t *rxBuffer);
uint8_t CheckCRC(void);
void SpiWriteReg (uint8_t address, uint8_t value);
void SpiWriteBurstReg(uint8_t addr, uint8_t *buffer, uint8_t num);
uint8_t SpiReadReg (uint8_t address);
void SpiReadBurstReg(uint8_t addr, uint8_t *buffer, uint8_t num);
void SpiStrobe (uint8_t value);
uint8_t SpiWriteRead (uint8_t value);
void setClb(uint8_t b, uint8_t s, uint8_t e);
uint8_t getCC1101(void);
uint8_t getMode(void);
void setSyncWord(uint8_t sh, uint8_t sl);
void setAddr(uint8_t v);
void setWhiteData(uint8_t v);
void setPktFormat(uint8_t v);
void setCrc(uint8_t v);
void setLengthConfig(uint8_t v);
void setPacketLength(uint8_t v);
void setDcFilterOff(uint8_t v);
void setManchester(uint8_t v);
void setSyncMode(uint8_t v);
void setFEC(uint8_t v);
void setPRE(uint8_t v);
void setPQT(uint8_t v);
void setCRC_AF(uint8_t v);
void setAppendStatus(uint8_t v);
void setAdrChk(uint8_t v);

uint8_t map(float value, float fromLow, float fromHigh, float toLow, float toHigh);


#endif /* SRC_CC1101_H_ */
