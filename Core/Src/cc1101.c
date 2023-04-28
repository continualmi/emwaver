/*
 * cc1101.c
 *
 *  Created on: 20/04/2023
 *      Author: luispl
 */
#include "cc1101.h"
#include "main.h"

#define   WRITE_BURST       0x40            //write burst
#define   READ_SINGLE       0x80            //read single
#define   READ_BURST        0xC0            //read burst
#define   uint8_tS_IN_RXFIFO   0x7F            //uint8_t number in RXfifo
#define   max_modul 6

uint8_t modulation = 2;
uint8_t frend0;
uint8_t chan = 0;
int pa = 12;
uint8_t last_pa;
uint8_t SCK_PIN;
uint8_t MISO_PIN;
uint8_t MOSI_PIN;
uint8_t SS_PIN;
uint8_t GDO0;
uint8_t GDO2;
uint8_t SCK_PIN_M[max_modul];
uint8_t MISO_PIN_M[max_modul];
uint8_t MOSI_PIN_M[max_modul];
uint8_t SS_PIN_M[max_modul];
uint8_t GDO0_M[max_modul];
uint8_t GDO2_M[max_modul];
uint8_t gdo_set=0;
uint8_t spi = 0;
uint8_t ccmode = 0;
float MHz = 433.92;
uint8_t m4RxBw = 0;
uint8_t m4DaRa;
uint8_t m2DCOFF;
uint8_t m2MODFM;
uint8_t m2MANCH;
uint8_t m2SYNCM;
uint8_t m1FEC;
uint8_t m1PRE;
uint8_t m1CHSP;
uint8_t pc1PQT;
uint8_t pc1CRC_AF;
uint8_t pc1APP_ST;
uint8_t pc1ADRCHK;
uint8_t pc0WDATA;
uint8_t pc0PktForm;
uint8_t pc0CRC_EN;
uint8_t pc0LenConf;
uint8_t trxstate = 0;
uint8_t clb1[2]= {24,28};
uint8_t clb2[2]= {31,38};
uint8_t clb3[2]= {65,76};
uint8_t clb4[2]= {77,79};

/****************************************************************/
uint8_t PA_TABLE[8] = {0x00,0xC0,0x00,0x00,0x00,0x00,0x00,0x00};
//                       -30  -20  -15  -10   0    5    7    10
uint8_t PA_TABLE_315[8] = {0x12,0x0D,0x1C,0x34,0x51,0x85,0xCB,0xC2};             //300 - 348
uint8_t PA_TABLE_433[8] = {0x12,0x0E,0x1D,0x34,0x60,0x84,0xC8,0xC0};             //387 - 464
//                        -30  -20  -15  -10  -6    0    5    7    10   12
uint8_t PA_TABLE_868[10] = {0x03,0x17,0x1D,0x26,0x37,0x50,0x86,0xCD,0xC5,0xC0};  //779 - 899.99
//                        -30  -20  -15  -10  -6    0    5    7    10   11
uint8_t PA_TABLE_915[10] = {0x03,0x0E,0x1E,0x27,0x38,0x8E,0x84,0xCC,0xC3,0xC0};  //900 - 928




void SpiWriteReg (uint8_t address, uint8_t value) {
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);  // pull the cs pin low
	HAL_SPI_Transmit (&hspi1, &address, 1, 100);  // write data to register
	HAL_SPI_Transmit (&hspi1, &value, 1, 100);  // write data to register
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);  // pull the cs pin high
}

void SpiWriteBurstReg(uint8_t addr, uint8_t *buffer, uint8_t num){
	uint8_t i, temp;
	temp = addr | WRITE_BURST;
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);  // pull the cs pin low
	HAL_SPI_Transmit (&hspi1, &temp, 1, 100);
	for (i = 0; i < num; i++){
	 HAL_SPI_Transmit (&hspi1, &buffer[i], 1, 100);
	}
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);
}

uint8_t SpiReadReg (uint8_t address) {
	address |= 0x80;  // read single
	uint8_t received;
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);  // pull the pin low
	HAL_SPI_Transmit (&hspi1, &address, 1, 100);  // send address
	HAL_SPI_Receive (&hspi1, &received, 1, 100);  // receive 6 uint8_ts data
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);  // pull the pin high

	return received;
}

void SpiReadBurstReg(uint8_t addr, uint8_t *buffer, uint8_t num){
	uint8_t i, temp;
	temp = addr | READ_BURST;
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);  // pull the pin high
	HAL_SPI_Transmit (&hspi1, &temp, 1, 100);
	for(i = 0; i < num ; i++){
		HAL_SPI_Receive (&hspi1, &buffer[i], 1, 100);
	}
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);  // pull the pin high
}

void SpiStrobe (uint8_t value) {
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);  // pull the cs pin low
	HAL_SPI_Transmit (&hspi1, &value, 1, 100);
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);  // pull the cs pin low

}

uint8_t SpiWriteRead (uint8_t value) {
	uint8_t received;
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);  // pull the cs pin low
	HAL_SPI_TransmitReceive (&hspi1, &value, &received, 1, 100);
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);  // pull the cs pin low
	return received;
}

/****************************************************************
*FUNCTION NAME:SpiStart
*FUNCTION     :spi communication start
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void SpiStart(void)
{
  /*// initialize the SPI pins
  pinMode(SCK_PIN, OUTPUT);
  pinMode(MOSI_PIN, OUTPUT);
  pinMode(MISO_PIN, INPUT);
  pinMode(SS_PIN, OUTPUT);

  // enable SPI
  #ifdef ESP32
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);
  #else
  SPI.begin();
  #endif*/
}
/****************************************************************
*FUNCTION NAME:SpiEnd
*FUNCTION     :spi communication disable
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void SpiEnd(void)
{
  /*// disable SPI
  SPI.endTransaction();
  SPI.end();*/
}
/****************************************************************
*FUNCTION NAME: GDO_Set()
*FUNCTION     : set GDO0,GDO2 pin for serial pinmode.
*INPUT        : none
*OUTPUT       : none
****************************************************************/
void GDO_Set (void)
{
	//pinMode(GDO0, OUTPUT);
	GPIO_InitTypeDef GPIO_InitStruct = {0};
	GPIO_InitStruct.Pin = GDO0_Pin;
	GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
	GPIO_InitStruct.Pull = GPIO_NOPULL;
	GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
	HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
	//pinMode(GDO2, INPUT);
}
/****************************************************************
*FUNCTION NAME: GDO_Set()
*FUNCTION     : set GDO0 for internal transmission mode.
*INPUT        : none
*OUTPUT       : none
****************************************************************/
void GDO0_Set (void)
{
  //pinMode(GDO0, INPUT);
  GPIO_InitTypeDef GPIO_InitStruct = {0};
  	GPIO_InitStruct.Pin = GDO0_Pin;
  	GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  	GPIO_InitStruct.Pull = GPIO_NOPULL;
  	GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  	HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
}
/****************************************************************
*FUNCTION NAME:Reset
*FUNCTION     :CC1101 reset //details refer datasheet of CC1101/CC1100//
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Reset (void)
{
	uint8_t temp = CC1101_SRES;
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);
	HAL_Delay(1);
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);
	HAL_Delay(1);
	HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);
	//while(digitalRead(MISO_PIN));

  HAL_SPI_Transmit (&hspi1, &temp, 1, 100);
 // while(digitalRead(MISO_PIN));
  HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);
}
/****************************************************************
*FUNCTION NAME:Init
*FUNCTION     :CC1101 initialization
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Init(void)
{
  setSpi();
  SpiStart();                   //spi initialization
  HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);
  //digitalWrite(SCK_PIN, HIGH);
  //digitalWrite(MOSI_PIN, LOW);
  Reset();                    //CC1101 reset
  RegConfigSettings();            //CC1101 register config
  SpiEnd();
}

/****************************************************************
*FUNCTION NAME:SpiReadStatus
*FUNCTION     :CC1101 read status register
*INPUT        :addr: register address
*OUTPUT       :status value
****************************************************************/
uint8_t SpiReadStatus(uint8_t addr)
{
  uint8_t value,temp;
  SpiStart();
  temp = addr | READ_BURST;
  HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_RESET);
  //while(digitalRead(MISO_PIN));
  HAL_SPI_Transmit (&hspi1, &temp, 1, 100);
  HAL_SPI_Receive (&hspi1, &value, 1, 100);
  HAL_GPIO_WritePin (GPIOA, NSS_Pin, GPIO_PIN_SET);
  SpiEnd();
  return value;
}
/****************************************************************
*FUNCTION NAME:SPI pin Settings
*FUNCTION     :Set Spi pins
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setSpi(void){
 /* if (spi == 0){
  SCK_PIN = 13; MISO_PIN = 12; MOSI_PIN = 11; SS_PIN = 10;
}*/
}
/****************************************************************
*FUNCTION NAME:COSTUM SPI
*FUNCTION     :set costum spi pins.
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setSpiPin(uint8_t sck, uint8_t miso, uint8_t mosi, uint8_t ss){
  /*spi = 1;
  SCK_PIN = sck;
  MISO_PIN = miso;
  MOSI_PIN = mosi;
  SS_PIN = ss;*/
}
/****************************************************************
*FUNCTION NAME:COSTUM SPI
*FUNCTION     :set costum spi pins.
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void addSpiPin(uint8_t sck, uint8_t miso, uint8_t mosi, uint8_t ss, uint8_t modul){
  /*spi = 1;
  SCK_PIN_M[modul] = sck;
  MISO_PIN_M[modul] = miso;
  MOSI_PIN_M[modul] = mosi;
  SS_PIN_M[modul] = ss;*/
}
/****************************************************************
*FUNCTION NAME:GDO Pin settings
*FUNCTION     :set GDO Pins
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setGDO(uint8_t gdo0, uint8_t gdo2){
/*GDO0 = gdo0;
GDO2 = gdo2;
GDO_Set();*/
}
/****************************************************************
*FUNCTION NAME:GDO0 Pin setting
*FUNCTION     :set GDO0 Pin
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setGDO0(uint8_t gdo0){
/*GDO0 = gdo0;
GDO0_Set();*/
}
/****************************************************************
*FUNCTION NAME:GDO Pin settings
*FUNCTION     :add GDO Pins
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void addGDO(uint8_t gdo0, uint8_t gdo2, uint8_t modul){
/*GDO0_M[modul] = gdo0;
GDO2_M[modul] = gdo2;
gdo_set=2;
GDO_Set();*/
}
/****************************************************************
*FUNCTION NAME:add GDO0 Pin
*FUNCTION     :add GDO0 Pin
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void addGDO0(uint8_t gdo0, uint8_t modul){
/*GDO0_M[modul] = gdo0;
gdo_set=1;
GDO0_Set();*/
}
/****************************************************************
*FUNCTION NAME:set Modul
*FUNCTION     :change modul
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setModul(uint8_t modul){
  /*SCK_PIN = SCK_PIN_M[modul];
  MISO_PIN = MISO_PIN_M[modul];
  MOSI_PIN = MOSI_PIN_M[modul];
  SS_PIN = SS_PIN_M[modul];
  if (gdo_set==1){
  GDO0 = GDO0_M[modul];
  }
  else if (gdo_set==2){
  GDO0 = GDO0_M[modul];
  GDO2 = GDO2_M[modul];
  }*/
}
/****************************************************************
*FUNCTION NAME:CCMode
*FUNCTION     :Format of RX and TX data
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setCCMode(uint8_t s){
ccmode = s;
if (ccmode == 1){
SpiWriteReg(CC1101_IOCFG2,      0x0B);
SpiWriteReg(CC1101_IOCFG0,      0x06);
SpiWriteReg(CC1101_PKTCTRL0,    0x05);
SpiWriteReg(CC1101_MDMCFG3,     0xF8);
SpiWriteReg(CC1101_MDMCFG4,11+m4RxBw);
}else{
SpiWriteReg(CC1101_IOCFG2,      0x0D);
SpiWriteReg(CC1101_IOCFG0,      0x0D);
SpiWriteReg(CC1101_PKTCTRL0,    0x32);
SpiWriteReg(CC1101_MDMCFG3,     0x93);
SpiWriteReg(CC1101_MDMCFG4, 7+m4RxBw);
}
setModulation(modulation);
}
/****************************************************************
*FUNCTION NAME:Modulation
*FUNCTION     :set CC1101 Modulation
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setModulation(uint8_t m){
if (m>4){m=4;}
modulation = m;
Split_MDMCFG2();
switch (m)
{
case 0: m2MODFM=0x00; frend0=0x10; break; // 2-FSK
case 1: m2MODFM=0x10; frend0=0x10; break; // GFSK
case 2: m2MODFM=0x30; frend0=0x11; break; // ASK
case 3: m2MODFM=0x40; frend0=0x10; break; // 4-FSK
case 4: m2MODFM=0x70; frend0=0x10; break; // MSK
}
SpiWriteReg(CC1101_MDMCFG2, m2DCOFF+m2MODFM+m2MANCH+m2SYNCM);
SpiWriteReg(CC1101_FREND0,   frend0);
setPA(pa);
}
/****************************************************************
*FUNCTION NAME:PA Power
*FUNCTION     :set CC1101 PA Power
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setPA(int p)
{
int a;
pa = p;

if (MHz >= 300 && MHz <= 348){
if (pa <= -30){a = PA_TABLE_315[0];}
else if (pa > -30 && pa <= -20){a = PA_TABLE_315[1];}
else if (pa > -20 && pa <= -15){a = PA_TABLE_315[2];}
else if (pa > -15 && pa <= -10){a = PA_TABLE_315[3];}
else if (pa > -10 && pa <= 0){a = PA_TABLE_315[4];}
else if (pa > 0 && pa <= 5){a = PA_TABLE_315[5];}
else if (pa > 5 && pa <= 7){a = PA_TABLE_315[6];}
else if (pa > 7){a = PA_TABLE_315[7];}
last_pa = 1;
}
else if (MHz >= 378 && MHz <= 464){
if (pa <= -30){a = PA_TABLE_433[0];}
else if (pa > -30 && pa <= -20){a = PA_TABLE_433[1];}
else if (pa > -20 && pa <= -15){a = PA_TABLE_433[2];}
else if (pa > -15 && pa <= -10){a = PA_TABLE_433[3];}
else if (pa > -10 && pa <= 0){a = PA_TABLE_433[4];}
else if (pa > 0 && pa <= 5){a = PA_TABLE_433[5];}
else if (pa > 5 && pa <= 7){a = PA_TABLE_433[6];}
else if (pa > 7){a = PA_TABLE_433[7];}
last_pa = 2;
}
else if (MHz >= 779 && MHz <= 899.99){
if (pa <= -30){a = PA_TABLE_868[0];}
else if (pa > -30 && pa <= -20){a = PA_TABLE_868[1];}
else if (pa > -20 && pa <= -15){a = PA_TABLE_868[2];}
else if (pa > -15 && pa <= -10){a = PA_TABLE_868[3];}
else if (pa > -10 && pa <= -6){a = PA_TABLE_868[4];}
else if (pa > -6 && pa <= 0){a = PA_TABLE_868[5];}
else if (pa > 0 && pa <= 5){a = PA_TABLE_868[6];}
else if (pa > 5 && pa <= 7){a = PA_TABLE_868[7];}
else if (pa > 7 && pa <= 10){a = PA_TABLE_868[8];}
else if (pa > 10){a = PA_TABLE_868[9];}
last_pa = 3;
}
else if (MHz >= 900 && MHz <= 928){
if (pa <= -30){a = PA_TABLE_915[0];}
else if (pa > -30 && pa <= -20){a = PA_TABLE_915[1];}
else if (pa > -20 && pa <= -15){a = PA_TABLE_915[2];}
else if (pa > -15 && pa <= -10){a = PA_TABLE_915[3];}
else if (pa > -10 && pa <= -6){a = PA_TABLE_915[4];}
else if (pa > -6 && pa <= 0){a = PA_TABLE_915[5];}
else if (pa > 0 && pa <= 5){a = PA_TABLE_915[6];}
else if (pa > 5 && pa <= 7){a = PA_TABLE_915[7];}
else if (pa > 7 && pa <= 10){a = PA_TABLE_915[8];}
else if (pa > 10){a = PA_TABLE_915[9];}
last_pa = 4;
}
if (modulation == 2){
PA_TABLE[0] = 0;
PA_TABLE[1] = a;
}else{
PA_TABLE[0] = a;
PA_TABLE[1] = 0;
}
SpiWriteBurstReg(CC1101_PATABLE,PA_TABLE,8);
}
/****************************************************************
*FUNCTION NAME:Frequency Calculator
*FUNCTION     :Calculate the basic frequency.
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setMHZ(float mhz){
uint8_t freq2 = 0;
uint8_t freq1 = 0;
uint8_t freq0 = 0;

MHz = mhz;

for (uint8_t i = 0; i==0;){
if (mhz >= 26){
mhz-=26;
freq2+=1;
}
else if (mhz >= 0.1015625){
mhz-=0.1015625;
freq1+=1;
}
else if (mhz >= 0.00039675){
mhz-=0.00039675;
freq0+=1;
}
else{i=1;}
}
if (freq0 > 255){freq1+=1;freq0-=256;}

SpiWriteReg(CC1101_FREQ2, freq2);
SpiWriteReg(CC1101_FREQ1, freq1);
SpiWriteReg(CC1101_FREQ0, freq0);

Calibrate(); //preformed at the end of a frequency change.
}
/****************************************************************
*FUNCTION NAME:Calibrate
*FUNCTION     :Calibrate frequency
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Calibrate(void){

if (MHz >= 300 && MHz <= 348){
SpiWriteReg(CC1101_FSCTRL0, map(MHz, 300, 348, clb1[0], clb1[1]));
if (MHz < 322.88){SpiWriteReg(CC1101_TEST0,0x0B);}
else{
SpiWriteReg(CC1101_TEST0,0x09);
int s = SpiReadStatus(CC1101_FSCAL2);
if (s<32){SpiWriteReg(CC1101_FSCAL2, s+32);}
if (last_pa != 1){setPA(pa);}
}
}
else if (MHz >= 378 && MHz <= 464){
SpiWriteReg(CC1101_FSCTRL0, map(MHz, 378, 464, clb2[0], clb2[1]));
if (MHz < 430.5){SpiWriteReg(CC1101_TEST0,0x0B);}
else{
SpiWriteReg(CC1101_TEST0,0x09);
int s = SpiReadStatus(CC1101_FSCAL2);
if (s<32){SpiWriteReg(CC1101_FSCAL2, s+32);}
if (last_pa != 2){setPA(pa);}
}
}
else if (MHz >= 779 && MHz <= 899.99){
SpiWriteReg(CC1101_FSCTRL0, map(MHz, 779, 899, clb3[0], clb3[1]));
if (MHz < 861){SpiWriteReg(CC1101_TEST0,0x0B);}
else{
SpiWriteReg(CC1101_TEST0,0x09);
int s = SpiReadStatus(CC1101_FSCAL2);
if (s<32){SpiWriteReg(CC1101_FSCAL2, s+32);}
if (last_pa != 3){setPA(pa);}
}
}
else if (MHz >= 900 && MHz <= 928){
SpiWriteReg(CC1101_FSCTRL0, map(MHz, 900, 928, clb4[0], clb4[1]));
SpiWriteReg(CC1101_TEST0,0x09);
int s = SpiReadStatus(CC1101_FSCAL2);
if (s<32){SpiWriteReg(CC1101_FSCAL2, s+32);}
if (last_pa != 4){setPA(pa);}
}
}
/****************************************************************
*FUNCTION NAME:Calibration offset
*FUNCTION     :Set calibration offset
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setClb(uint8_t b, uint8_t s, uint8_t e){
if (b == 1){
clb1[0]=s;
clb1[1]=e;
}
else if (b == 2){
clb2[0]=s;
clb2[1]=e;
}
else if (b == 3){
clb3[0]=s;
clb3[1]=e;
}
else if (b == 4){
clb4[0]=s;
clb4[1]=e;
}
}
/****************************************************************
*FUNCTION NAME:getCC1101
*FUNCTION     :Test Spi connection and return 1 when true.
*INPUT        :none
*OUTPUT       :none
****************************************************************/
uint8_t getCC1101(void){
setSpi();
if (SpiReadStatus(0x31)>0){
return 1;
}else{
return 0;
}
}
/****************************************************************
*FUNCTION NAME:getMode
*FUNCTION     :Return the Mode. Sidle = 0, TX = 1, Rx = 2.
*INPUT        :none
*OUTPUT       :none
****************************************************************/
uint8_t getMode(void){
return trxstate;
}
/****************************************************************
*FUNCTION NAME:Set Sync_Word
*FUNCTION     :Sync Word
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setSyncWord(uint8_t sh, uint8_t sl){
SpiWriteReg(CC1101_SYNC1, sh);
SpiWriteReg(CC1101_SYNC0, sl);
}
/****************************************************************
*FUNCTION NAME:Set ADDR
*FUNCTION     :Address used for packet filtration. Optional broadcast addresses are 0 (0x00) and 255 (0xFF).
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setAddr(uint8_t v){
SpiWriteReg(CC1101_ADDR, v);
}
/****************************************************************
*FUNCTION NAME:Set PQT
*FUNCTION     :Preamble quality estimator threshold
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setPQT(uint8_t v){
Split_PKTCTRL1();
pc1PQT = 0;
if (v>7){v=7;}
pc1PQT = v*32;
SpiWriteReg(CC1101_PKTCTRL1, pc1PQT+pc1CRC_AF+pc1APP_ST+pc1ADRCHK);
}
/****************************************************************
*FUNCTION NAME:Set CRC_AUTOFLUSH
*FUNCTION     :Enable automatic flush of RX FIFO when CRC is not OK
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setCRC_AF(uint8_t v){
Split_PKTCTRL1();
pc1CRC_AF = 0;
if (v==1){pc1CRC_AF=8;}
SpiWriteReg(CC1101_PKTCTRL1, pc1PQT+pc1CRC_AF+pc1APP_ST+pc1ADRCHK);
}
/****************************************************************
*FUNCTION NAME:Set APPEND_STATUS
*FUNCTION     :When enabled, two status uint8_ts will be appended to the payload of the packet
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setAppendStatus(uint8_t v){
Split_PKTCTRL1();
pc1APP_ST = 0;
if (v==1){pc1APP_ST=4;}
SpiWriteReg(CC1101_PKTCTRL1, pc1PQT+pc1CRC_AF+pc1APP_ST+pc1ADRCHK);
}
/****************************************************************
*FUNCTION NAME:Set ADR_CHK
*FUNCTION     :Controls address check configuration of received packages
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setAdrChk(uint8_t v){
Split_PKTCTRL1();
pc1ADRCHK = 0;
if (v>3){v=3;}
pc1ADRCHK = v;
SpiWriteReg(CC1101_PKTCTRL1, pc1PQT+pc1CRC_AF+pc1APP_ST+pc1ADRCHK);
}
/****************************************************************
*FUNCTION NAME:Set WHITE_DATA
*FUNCTION     :Turn data whitening on / off.
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setWhiteData(uint8_t v){
Split_PKTCTRL0();
pc0WDATA = 0;
if (v == 1){pc0WDATA=64;}
SpiWriteReg(CC1101_PKTCTRL0, pc0WDATA+pc0PktForm+pc0CRC_EN+pc0LenConf);
}
/****************************************************************
*FUNCTION NAME:Set PKT_FORMAT
*FUNCTION     :Format of RX and TX data
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setPktFormat(uint8_t v){
Split_PKTCTRL0();
pc0PktForm = 0;
if (v>3){v=3;}
pc0PktForm = v*16;
SpiWriteReg(CC1101_PKTCTRL0, pc0WDATA+pc0PktForm+pc0CRC_EN+pc0LenConf);
}
/****************************************************************
*FUNCTION NAME:Set CRC
*FUNCTION     :CRC calculation in TX and CRC check in RX
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setCrc(uint8_t v){
Split_PKTCTRL0();
pc0CRC_EN = 0;
if (v==1){pc0CRC_EN=4;}
SpiWriteReg(CC1101_PKTCTRL0, pc0WDATA+pc0PktForm+pc0CRC_EN+pc0LenConf);
}
/****************************************************************
*FUNCTION NAME:Set LENGTH_CONFIG
*FUNCTION     :Configure the packet length
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setLengthConfig(uint8_t v){
Split_PKTCTRL0();
pc0LenConf = 0;
if (v>3){v=3;}
pc0LenConf = v;
SpiWriteReg(CC1101_PKTCTRL0, pc0WDATA+pc0PktForm+pc0CRC_EN+pc0LenConf);
}
/****************************************************************
*FUNCTION NAME:Set PACKET_LENGTH
*FUNCTION     :Indicates the packet length
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setPacketLength(uint8_t v){
SpiWriteReg(CC1101_PKTLEN, v);
}
/****************************************************************
*FUNCTION NAME:Set DCFILT_OFF
*FUNCTION     :Disable digital DC blocking filter before demodulator
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setDcFilterOff(uint8_t v){
Split_MDMCFG2();
m2DCOFF = 0;
if (v==1){m2DCOFF=128;}
SpiWriteReg(CC1101_MDMCFG2, m2DCOFF+m2MODFM+m2MANCH+m2SYNCM);
}
/****************************************************************
*FUNCTION NAME:Set MANCHESTER
*FUNCTION     :Enables Manchester encoding/decoding
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setManchester(uint8_t v){
Split_MDMCFG2();
m2MANCH = 0;
if (v==1){m2MANCH=8;}
SpiWriteReg(CC1101_MDMCFG2, m2DCOFF+m2MODFM+m2MANCH+m2SYNCM);
}
/****************************************************************
*FUNCTION NAME:Set SYNC_MODE
*FUNCTION     :Combined sync-word qualifier mode
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setSyncMode(uint8_t v){
Split_MDMCFG2();
m2SYNCM = 0;
if (v>7){v=7;}
m2SYNCM=v;
SpiWriteReg(CC1101_MDMCFG2, m2DCOFF+m2MODFM+m2MANCH+m2SYNCM);
}
/****************************************************************
*FUNCTION NAME:Set FEC
*FUNCTION     :Enable Forward Error Correction (FEC)
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setFEC(uint8_t v){
Split_MDMCFG1();
m1FEC=0;
if (v==1){m1FEC=128;}
SpiWriteReg(CC1101_MDMCFG1, m1FEC+m1PRE+m1CHSP);
}
/****************************************************************
*FUNCTION NAME:Set PRE
*FUNCTION     :Sets the minimum number of preamble uint8_ts to be transmitted.
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setPRE(uint8_t v){
Split_MDMCFG1();
m1PRE=0;
if (v>7){v=7;}
m1PRE = v*16;
SpiWriteReg(CC1101_MDMCFG1, m1FEC+m1PRE+m1CHSP);
}

/****************************************************************
*FUNCTION NAME:Set Receive bandwidth
*FUNCTION     :none
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setRxBW(float f){
Split_MDMCFG4();
int s1 = 3;
int s2 = 3;
for (int i = 0; i<3; i++){
if (f > 101.5625){f/=2; s1--;}
else{i=3;}
}
for (int i = 0; i<3; i++){
if (f > 58.1){f/=1.25; s2--;}
else{i=3;}
}
s1 *= 64;
s2 *= 16;
m4RxBw = s1 + s2;
SpiWriteReg(16,m4RxBw+m4DaRa);
}
/****************************************************************
*FUNCTION NAME:Set Devitation
*FUNCTION     :none
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setDeviation(float d){
float f = 1.586914;
float v = 0.19836425;
int c = 0;
if (d > 380.859375){d = 380.859375;}
if (d < 1.586914){d = 1.586914;}
for (int i = 0; i<255; i++){
f+=v;
if (c==7){v*=2;c=-1;i+=8;}
if (f>=d){c=i;i=255;}
c++;
}
SpiWriteReg(21,c);
}
/****************************************************************
*FUNCTION NAME:Split PKTCTRL0
*FUNCTION     :none
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Split_PKTCTRL1(void){
int calc = SpiReadStatus(7);
pc1PQT = 0;
pc1CRC_AF = 0;
pc1APP_ST = 0;
pc1ADRCHK = 0;
for (uint8_t i = 0; i==0;){
if (calc >= 32){calc-=32; pc1PQT+=32;}
else if (calc >= 8){calc-=8; pc1CRC_AF+=8;}
else if (calc >= 4){calc-=4; pc1APP_ST+=4;}
else {pc1ADRCHK = calc; i=1;}
}
}
/****************************************************************
*FUNCTION NAME:Split PKTCTRL0
*FUNCTION     :none
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Split_PKTCTRL0(void){
int calc = SpiReadStatus(8);
pc0WDATA = 0;
pc0PktForm = 0;
pc0CRC_EN = 0;
pc0LenConf = 0;
for (uint8_t i = 0; i==0;){
if (calc >= 64){calc-=64; pc0WDATA+=64;}
else if (calc >= 16){calc-=16; pc0PktForm+=16;}
else if (calc >= 4){calc-=4; pc0CRC_EN+=4;}
else {pc0LenConf = calc; i=1;}
}
}
/****************************************************************
*FUNCTION NAME:Split MDMCFG1
*FUNCTION     :none
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Split_MDMCFG1(void){
int calc = SpiReadStatus(19);
m1FEC = 0;
m1PRE = 0;
m1CHSP = 0;
int s2 = 0;
for (uint8_t i = 0; i==0;){
if (calc >= 128){calc-=128; m1FEC+=128;}
else if (calc >= 16){calc-=16; m1PRE+=16;}
else {m1CHSP = calc; i=1;}
}
}
/****************************************************************
*FUNCTION NAME:Split MDMCFG2
*FUNCTION     :none
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Split_MDMCFG2(void){
int calc = SpiReadStatus(18);
m2DCOFF = 0;
m2MODFM = 0;
m2MANCH = 0;
m2SYNCM = 0;
for (uint8_t i = 0; i==0;){
if (calc >= 128){calc-=128; m2DCOFF+=128;}
else if (calc >= 16){calc-=16; m2MODFM+=16;}
else if (calc >= 8){calc-=8; m2MANCH+=8;}
else{m2SYNCM = calc; i=1;}
}
}
/****************************************************************
*FUNCTION NAME:Split MDMCFG4
*FUNCTION     :none
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void Split_MDMCFG4(void){
int calc = SpiReadStatus(16);
m4RxBw = 0;
m4DaRa = 0;
for (uint8_t i = 0; i==0;){
if (calc >= 64){calc-=64; m4RxBw+=64;}
else if (calc >= 16){calc -= 16; m4RxBw+=16;}
else{m4DaRa = calc; i=1;}
}
}
/****************************************************************
*FUNCTION NAME:RegConfigSettings
*FUNCTION     :CC1101 register config //details refer datasheet of CC1101/CC1100//
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void RegConfigSettings(void)
{
    SpiWriteReg(CC1101_FSCTRL1,  0x06);

    setCCMode(ccmode);
    setMHZ(MHz);

    SpiWriteReg(CC1101_MDMCFG1,  0x02);
    SpiWriteReg(CC1101_MDMCFG0,  0xF8);
    SpiWriteReg(CC1101_CHANNR,   chan);
    SpiWriteReg(CC1101_DEVIATN,  0x47);
    SpiWriteReg(CC1101_FREND1,   0x56);
    SpiWriteReg(CC1101_MCSM0 ,   0x18);
    SpiWriteReg(CC1101_FOCCFG,   0x16);
    SpiWriteReg(CC1101_BSCFG,    0x1C);
    SpiWriteReg(CC1101_AGCCTRL2, 0xC7);
    SpiWriteReg(CC1101_AGCCTRL1, 0x00);
    SpiWriteReg(CC1101_AGCCTRL0, 0xB2);
    SpiWriteReg(CC1101_FSCAL3,   0xE9);
    SpiWriteReg(CC1101_FSCAL2,   0x2A);
    SpiWriteReg(CC1101_FSCAL1,   0x00);
    SpiWriteReg(CC1101_FSCAL0,   0x1F);
    SpiWriteReg(CC1101_FSTEST,   0x59);
    SpiWriteReg(CC1101_TEST2,    0x81);
    SpiWriteReg(CC1101_TEST1,    0x35);
    SpiWriteReg(CC1101_TEST0,    0x09);
    SpiWriteReg(CC1101_PKTCTRL1, 0x04);
    SpiWriteReg(CC1101_ADDR,     0x00);
    SpiWriteReg(CC1101_PKTLEN,   0x00);
}
/****************************************************************
*FUNCTION NAME:SetTx
*FUNCTION     :set CC1101 send data
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void SetTx(void)
{
  SpiStrobe(CC1101_SIDLE);
  SpiStrobe(CC1101_STX);        //start send
  trxstate=1;
}
/****************************************************************
*FUNCTION NAME:SetRx
*FUNCTION     :set CC1101 to receive state
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void SetRx(void)
{
  SpiStrobe(CC1101_SIDLE);
  SpiStrobe(CC1101_SRX);        //start receive
  trxstate=2;
}
/****************************************************************
*FUNCTION NAME:RSSI Level
*FUNCTION     :Calculating the RSSI Level
*INPUT        :none
*OUTPUT       :none
****************************************************************/
int getRssi(void)
{
int rssi;
rssi=SpiReadStatus(CC1101_RSSI);
if (rssi >= 128){rssi = (rssi-256)/2-74;}
else{rssi = (rssi/2)-74;}
return rssi;
}

/****************************************************************
*FUNCTION NAME:SetSres
*FUNCTION     :Reset CC1101
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setSres(void)
{
  SpiStrobe(CC1101_SRES);
  trxstate=0;
}
/****************************************************************
*FUNCTION NAME:setSidle
*FUNCTION     :set Rx / TX Off
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void setSidle(void)
{
  SpiStrobe(CC1101_SIDLE);
  trxstate=0;
}
/****************************************************************
*FUNCTION NAME:goSleep
*FUNCTION     :set cc1101 Sleep on
*INPUT        :none
*OUTPUT       :none
****************************************************************/
void goSleep(void){
  trxstate=0;
  SpiStrobe(0x36);//Exit RX / TX, turn off frequency synthesizer and exit
  SpiStrobe(0x39);//Enter power down mode when CSn goes high.
}



uint8_t map(float value, float fromLow, float fromHigh, float toLow, float toHigh) {
  // Make sure the value is within the fromLow-fromHigh range
  value = (value < fromLow) ? fromLow : value;
  value = (value > fromHigh) ? fromHigh : value;

  // Map the value to the toLow-toHigh range
  uint8_t mapped = (uint8_t) ((value - fromLow) * (toHigh - toLow) / (fromHigh - fromLow) + toLow);

  return mapped;
}


