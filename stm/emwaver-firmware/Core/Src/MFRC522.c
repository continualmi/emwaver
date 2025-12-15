
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <inttypes.h>
#include <stdbool.h>
#include "MFRC522.h"
#include "command_registry.h"
#include "usbd_cdc_if.h"
//------------------------------------------------------
/*
 * Function Nameï¼šWrite_MFRC5200
 * Function Description: To a certain MFRC522 register to write a byte of data
 * Input Parametersï¼šaddr - register address; val - the value to be written
 * Return value: None
 */
void Write_MFRC522(u_char addr, u_char val) {
  //uint32_t rx_bits;
	  u_char addr_bits = (((addr<<1) & 0x7E));
  //u_char rx_bits;
  // set the select line so we can start transferring
//  MSS_SPI_set_slave_select( &g_mss_spi1, MSS_SPI_SLAVE_0 );
  HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_RESET);
  // even though we are calling transfer frame once, we are really sending
  // two 8-bit frames smooshed together-- sending two 8 bit frames back to back
  // results in a spike in the select line which will jack with transactions
  // - top 8 bits are the address. Per the spec, we shift the address left
  //   1 bit, clear the LSb, and clear the MSb to indicate a write
  // - bottom 8 bits are the data bits being sent for that address, we send
  //   them as is
//  rx_bits = MSS_SPI_transfer_frame( &g_mss_spi1, (((addr << 1) & 0x7E) << 8) |  val );
  //HAL_SPI_TransmitReceive(&hspi1, (((addr << 1) & 0x7E) << 8) |  val , rx_bits, 1, 500);
  HAL_SPI_Transmit(&hspi1, &addr_bits, 1, 500);
  HAL_SPI_Transmit(&hspi1, &val, 1, 500);
  // clear the select line-- we are done here
//  MSS_SPI_clear_slave_select( &g_mss_spi1, MSS_SPI_SLAVE_0 );
  HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);

  // burn some time
  // volatile uint32_t ticks;
  // for(ticks=0; ticks < 5000; ++ticks);
}
//-----------------------------------------------
/*
 * Function Name: Read_MFRC522
 * Description: From a certain MFRC522 read a byte of data register
 * Input Parameters: addr - register address
 * Returns: a byte of data read from the
 */
u_char Read_MFRC522(u_char addr) {
  //uint32_t rx_bits;
  u_char rx_bits;
  u_char addr_bits = (((addr<<1) & 0x7E) | 0x80);

  // set the select line so we can start transferring
//  MSS_SPI_set_slave_select( &g_mss_spi1, MSS_SPI_SLAVE_0 );
  HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_RESET);

  // even though we are calling transfer frame once, we are really sending
  // two 8-bit frames smooshed together-- sending two 8 bit frames back to back
  // results in a spike in the select line which will jack with transactions
  // - top 8 bits are the address. Per the spec, we shift the address left
  //   1 bit, clear the LSb, and set the MSb to indicate a read
  // - bottom 8 bits are all 0s on a read per 8.1.2.1 Table 6
//  rx_bits = MSS_SPI_transfer_frame( &g_mss_spi1, ((((addr << 1) & 0x7E) | 0x80) << 8) | 0x00 );
  //HAL_SPI_TransmitReceive(&hspi1, ((((addr << 1) & 0x7E) | 0x80) << 8) | 0x00 , rx_bits, 1, 500);
//HAL_SPI_Transmit(&hspi1, (unsigned char*) ((((addr<<1) & 0x7E) | 0x80)), 1, 500);
HAL_SPI_Transmit(&hspi1, &addr_bits, 1, 500);

  HAL_SPI_Receive(&hspi1, &rx_bits, 1, 500);
  // clear the select line-- we are done here
//  MSS_SPI_clear_slave_select( &g_mss_spi1, MSS_SPI_SLAVE_0 );

  // burn some time
  // volatile uint32_t ticks;
  // for(ticks=0; ticks < 5000; ++ticks);
  HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);

	return (u_char) rx_bits; // return the rx bits, casting to an 8 bit int and chopping off the upper 24 bits
}
//--------------------------------------------------------
/*
 * Function Nameï¼šSetBitMask
 * Description: Set RC522 register bit
 * Input parameters: reg - register address; mask - set value
 * Return value: None
 */
void SetBitMask(u_char reg, u_char mask)
{
    u_char tmp;
    tmp = Read_MFRC522(reg);
    Write_MFRC522(reg, tmp | mask);  // set bit mask
}
//
/*
 * Function Name: ClearBitMask
 * Description: clear RC522 register bit
 * Input parameters: reg - register address; mask - clear bit value
 * Return value: None
*/
void ClearBitMask(u_char reg, u_char mask)
{
    u_char tmp;
    tmp = Read_MFRC522(reg);
    Write_MFRC522(reg, tmp & (~mask));  // clear bit mask
}

//-----------------------------------------------
/*
 * Function Nameï¼šAntennaOn
 * Description: Open antennas, each time you start or shut down the natural barrier between the transmitter should be at least 1ms interval
 * Input: None
 * Return value: None
 */
void AntennaOn(void)
{
  SetBitMask(TxControlReg, 0x03);
}


/*
  * Function Name: AntennaOff
  * Description: Close antennas, each time you start or shut down the natural barrier between the transmitter should be at least 1ms interval
  * Input: None
  * Return value: None
 */
void AntennaOff(void)
{
  ClearBitMask(TxControlReg, 0x03);
}


/*
 * Function Name: ResetMFRC522
 * Description: Reset RC522
 * Input: None
 * Return value: None
 */
void MFRC522_Reset(void)
{
  Write_MFRC522(CommandReg, PCD_RESETPHASE);
}
//--------------------------------------------------
/*
 * Function Nameï¼šInitMFRC522
 * Description: Initialize RC522
 * Input: None
 * Return value: None
*/
void MFRC522_Init(void)
{
  // Read the version register before reset
  u_char version = Read_MFRC522(VersionReg);

  // Check if the version is supported
  if (version == 0xB2 || version == 0x92 || version == 0x91)
  {
    // Proceed with reset and initialization
    MFRC522_Reset();

    // Timer: TPrescaler*TreloadVal/6.78MHz = 24ms
    Write_MFRC522(TModeReg, 0x80);    // Tauto=1; f(Timer) = 6.78MHz/TPreScaler
    Write_MFRC522(TPrescalerReg, 0xA9);
    Write_MFRC522(TReloadRegL, 0x03);
    Write_MFRC522(TReloadRegH, 0xE8);
    Write_MFRC522(TxAutoReg, 0x40);   // force 100% ASK modulation
    Write_MFRC522(ModeReg, 0x3D);     // CRC Initial value 0x6363

    // turn antenna on
    AntennaOn();
  }
}
//------------------------------------------------------------------
/*
 * Function Nameï¼šMFRC522_Request
 * Description: Find cards, read the card type number
 * Input parameters: reqMode - find cards way
 *   TagType - Return Card Type
 *    0x4400 = Mifare_UltraLight
 *    0x0400 = Mifare_One(S50)
 *    0x0200 = Mifare_One(S70)
 *    0x0800 = Mifare_Pro(X)
 *    0x4403 = Mifare_DESFire
 * Return value: the successful return MI_OK
 */
u_char MFRC522_Request(u_char reqMode, u_char *TagType)
{
  u_char status;
  uint backBits; // The received data bits

  Write_MFRC522(BitFramingReg, 0x07);   // TxLastBists = BitFramingReg[2..0]

  TagType[0] = reqMode;

  status = MFRC522_ToCard(PCD_TRANSCEIVE, TagType, 1, TagType, &backBits);
  if ((status != MI_OK) || (backBits != 0x10)) {
    status = MI_ERR;
  }

  return status;
}

//-----------------------------------------------
/*
 * Function Name: MFRC522_ToCard
 * Description: RC522 and ISO14443 card communication
 * Input Parameters: command - MF522 command word,
 *			 sendData--RC522 sent to the card by the data
 *			 sendLen--Length of data sent
 *			 backData--Received the card returns data,
 *			 backLen--Return data bit length
 * Return value: the successful return MI_OK
 */
u_char MFRC522_ToCard(u_char command, u_char *sendData, u_char sendLen, u_char *backData, uint *backLen)
{
  u_char status = MI_ERR;
  u_char irqEn = 0x00;
  u_char waitIRq = 0x00;
  u_char lastBits;
  u_char n;
  uint i;

  switch (command)
  {
    case PCD_AUTHENT:     // Certification cards close
      {
        irqEn = 0x12;
        waitIRq = 0x10;
        break;
      }
    case PCD_TRANSCEIVE:  // Transmit FIFO data
      {
        irqEn = 0x77;
        waitIRq = 0x30;
        break;
      }
    default:
      break;
  }

  Write_MFRC522(CommIEnReg, irqEn|0x80);  // Interrupt request
  ClearBitMask(CommIrqReg, 0x80);         // Clear all interrupt request bit
  SetBitMask(FIFOLevelReg, 0x80);         // FlushBuffer=1, FIFO Initialization

  Write_MFRC522(CommandReg, PCD_IDLE);    // NO action; Cancel the current command

  // Writing data to the FIFO
  for (i=0; i<sendLen; i++)
  {
    Write_MFRC522(FIFODataReg, sendData[i]);
  }

  // Execute the command
  Write_MFRC522(CommandReg, command);
  if (command == PCD_TRANSCEIVE)
  {
    SetBitMask(BitFramingReg, 0x80);      // StartSend=1,transmission of data starts
  }

  // Waiting to receive data to complete
  i = 2000;	// i according to the clock frequency adjustment, the operator M1 card maximum waiting time 25ms
  do
  {
    // CommIrqReg[7..0]
    // Set1 TxIRq RxIRq IdleIRq HiAlerIRq LoAlertIRq ErrIRq TimerIRq
    n = Read_MFRC522(CommIrqReg);
    i--;
  }
  while ((i!=0) && !(n&0x01) && !(n&waitIRq));

  ClearBitMask(BitFramingReg, 0x80);      // StartSend=0

  if (i != 0)
  {
    if(!(Read_MFRC522(ErrorReg) & 0x1B))  // BufferOvfl Collerr CRCErr ProtecolErr
    {
      status = MI_OK;
      if (n & irqEn & 0x01)
      {
        status = MI_NOTAGERR;             // ??
      }

      if (command == PCD_TRANSCEIVE)
      {
        n = Read_MFRC522(FIFOLevelReg);
        lastBits = Read_MFRC522(ControlReg) & 0x07;
        if (lastBits)
        {
          *backLen = (n-1)*8 + lastBits;
        }
        else
        {
          *backLen = n*8;
        }

        if (n == 0)
        {
          n = 1;
        }
        if (n > MAX_LEN)
        {
          n = MAX_LEN;
        }

        // Reading the received data in FIFO
        for (i=0; i<n; i++)
        {
          backData[i] = Read_MFRC522(FIFODataReg);
        }
      }
    }
    else {
      //printf("~~~ buffer overflow, collerr, crcerr, or protecolerr\r\n");
      status = MI_ERR;
    }
  }
  else {
    //printf("~~~ request timed out\r\n");
  }

  return status;
}


//---------------------------------------------------------------

/*
 * Function Name: MFRC522_Anticoll
 * Description: Anti-collision detection, reading selected card serial number card
 * Input parameters: serNum - returns 4 bytes card serial number, the first 5 bytes for the checksum byte
 * Return value: the successful return MI_OK
 */
u_char MFRC522_Anticoll(u_char *serNum)
{
  u_char status;
  u_char i;
  u_char serNumCheck=0;
  uint unLen;


  //ClearBitMask(Status2Reg, 0x08);		//TempSensclear
  //ClearBitMask(CollReg,0x80);			//ValuesAfterColl
  Write_MFRC522(BitFramingReg, 0x00);		//TxLastBists = BitFramingReg[2..0]

  serNum[0] = PICC_ANTICOLL;
  serNum[1] = 0x20;
  status = MFRC522_ToCard(PCD_TRANSCEIVE, serNum, 2, serNum, &unLen);

  if (status == MI_OK)
  {
    //Check card serial number
    for (i=0; i<4; i++)
    {
      serNumCheck ^= serNum[i];
    }
    if (serNumCheck != serNum[i])
    {
      status = MI_ERR;
    }
  }

  //SetBitMask(CollReg, 0x80);		//ValuesAfterColl=1

  return status;
}
//---------------------------------------------------



/*
 * Function Name: MFRC522_Read
 * Description: Read block data
 * Input parameters: blockAddr - block address; recvData - read block data
 * Return value: the successful return MI_OK
 */
u_char MFRC522_Read(u_char blockAddr, u_char *recvData)
{
  u_char status;
  uint unLen;

  recvData[0] = PICC_READ;
  recvData[1] = blockAddr;
  CalulateCRC(recvData,2, &recvData[2]);
  status = MFRC522_ToCard(PCD_TRANSCEIVE, recvData, 4, recvData, &unLen);

  if ((status != MI_OK) || (unLen != 0x90))
  {
    status = MI_ERR;
  }

  return status;
}


/*
 * Function Name: MFRC522_Write
 * Description: Write block data
 * Input parameters: blockAddr - block address; writeData - to 16-byte data block write
 * Return value: the successful return MI_OK
 */
u_char MFRC522_Write(u_char blockAddr, u_char *writeData)
{
  u_char status;
  uint recvBits;
  u_char i;
  u_char buff[18];

  buff[0] = PICC_WRITE;
  buff[1] = blockAddr;
  CalulateCRC(buff, 2, &buff[2]);
  status = MFRC522_ToCard(PCD_TRANSCEIVE, buff, 4, buff, &recvBits);

  if ((status != MI_OK))// || (recvBits != 4) || ((buff[0] & 0x0F) != 0x0A))
  {
    status = MI_ERR;
  }

  if (status == MI_OK)
  {
    for (i=0; i<16; i++)		//Data to the FIFO write 16Byte
    {
      buff[i] = *(writeData+i);
    }
    CalulateCRC(buff, 16, &buff[16]);
    status = MFRC522_ToCard(PCD_TRANSCEIVE, buff, 18, buff, &recvBits);

    if ((status != MI_OK))// || (recvBits != 4) || ((buff[0] & 0x0F) != 0x0A))
    {
      status = MI_ERR;
    }
  }

  return status;
}

/*
 * Function Name: CalulateCRC
 * Description: CRC calculation with MF522
 * Input parameters: pIndata - To read the CRC data, len - the data length, pOutData - CRC calculation results
 * Return value: None
 */
void CalulateCRC(u_char *pIndata, u_char len, u_char *pOutData)
{
  u_char i, n;

  ClearBitMask(DivIrqReg, 0x04);			//CRCIrq = 0
  SetBitMask(FIFOLevelReg, 0x80);			//Clear the FIFO pointer
  //Write_MFRC522(CommandReg, PCD_IDLE);

  //Writing data to the FIFO
  for (i=0; i<len; i++)
  {
    Write_MFRC522(FIFODataReg, *(pIndata+i));
  }
  Write_MFRC522(CommandReg, PCD_CALCCRC);

  //Wait CRC calculation is complete
  i = 0xFF;
  do
  {
    n = Read_MFRC522(DivIrqReg);
    i--;
  }
  while ((i!=0) && !(n&0x04));			//CRCIrq = 1

  //Read CRC calculation result
  pOutData[0] = Read_MFRC522(CRCResultRegL);
  pOutData[1] = Read_MFRC522(CRCResultRegM);
}

//--------------------------------------------------------------
/*
 * Function Name: MFRC522_Auth
 * Description: Verify card password
 * Input parameters: authMode - Password Authentication Mode
                 0x60 = A key authentication
                 0x61 = Authentication Key B
             BlockAddr--Block address
             Sectorkey--Sector password
             serNum--Card serial number, 4-byte
 * Return value: the successful return MI_OK
 */
u_char MFRC522_Auth(u_char authMode, u_char BlockAddr, u_char *Sectorkey, u_char *serNum)
{
  u_char status;
  uint recvBits;
  u_char i;
  u_char buff[12];

  //Verify the command block address + sector + password + card serial number
  buff[0] = authMode;
  buff[1] = BlockAddr;
  for (i=0; i<6; i++)
  {
    buff[i+2] = *(Sectorkey+i);
  }
  for (i=0; i<4; i++)
  {
    buff[i+8] = *(serNum+i);
  }
  status = MFRC522_ToCard(PCD_AUTHENT, buff, 12, buff, &recvBits);

  if ((status != MI_OK) || (!(Read_MFRC522(Status2Reg) & 0x08)))
  {
    status = MI_ERR;
  }

  return status;
}

//----------------------------------
/*
 * Function Name: MFRC522_SelectTag
 * Description: election card, read the card memory capacity
 * Input parameters: serNum - Incoming card serial number
 * Return value: the successful return of card capacity
 */
u_char MFRC522_SelectTag(u_char *serNum)
{
  u_char i;
  u_char status;
  u_char size;
  uint recvBits;
  u_char buffer[9];

  //ClearBitMask(Status2Reg, 0x08);			//MFCrypto1On=0

  buffer[0] = PICC_SElECTTAG;
  buffer[1] = 0x70;
  for (i=0; i<5; i++)
  {
    buffer[i+2] = *(serNum+i);
  }
  CalulateCRC(buffer, 7, &buffer[7]);		//??
  status = MFRC522_ToCard(PCD_TRANSCEIVE, buffer, 9, buffer, &recvBits);

  if ((status == MI_OK) && (recvBits == 0x18))
  {
    size = buffer[0];
  }
  else
  {
    size = 0;
  }

  return size;
}
//----------------------------------------------------

/*
 * Function Name: MFRC522_Halt
 * Description: Command card into hibernation
 * Input: None
 * Return value: None
 */
void MFRC522_Halt(void)
{
  u_char status;
  uint unLen;
  u_char buff[4];

  buff[0] = PICC_HALT;
  buff[1] = 0;
  CalulateCRC(buff, 2, &buff[2]);

  status = MFRC522_ToCard(PCD_TRANSCEIVE, buff, 4, buff,&unLen);
  //return status;
}
//--------------------------------------
void MFRC522_StopCrypto1(void) {
	// Clear MFCrypto1On bit
	ClearBitMask(Status2Reg, 0x08); // Status2Reg[7..0] bits are: TempSensClear I2CForceHS reserved reserved   MFCrypto1On ModemState[2:0]
} // End PCD_StopCrypto1()

static bool mfrc522_initialized = false;

static bool mfrc522_is_present(void)
{
  u_char version = Read_MFRC522(VersionReg);
  return version == 0xB2 || version == 0x92 || version == 0x91;
}

static void mfrc522_ensure_initialized(void)
{
  if (mfrc522_initialized) {
    return;
  }
  MFRC522_Init();
  mfrc522_initialized = true;
}

static int hex_nibble(char c)
{
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
  return -1;
}

static bool parse_hex_bytes_relaxed(const char *str, uint8_t *out, size_t out_max, size_t *out_len)
{
  if (!str || !out || !out_len) {
    return false;
  }

  size_t written = 0;
  int pending = -1;

  for (const char *p = str; *p; ++p) {
    char c = *p;
    if (c == '0' && (p[1] == 'x' || p[1] == 'X')) {
      ++p;
      continue;
    }
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == ',' || c == ':' || c == '_' || c == '-') {
      continue;
    }

    int nib = hex_nibble(c);
    if (nib < 0) {
      return false;
    }

    if (pending < 0) {
      pending = nib;
    } else {
      if (written >= out_max) {
        return false;
      }
      out[written++] = (uint8_t)((pending << 4) | nib);
      pending = -1;
    }
  }

  if (pending >= 0) {
    return false;
  }

  *out_len = written;
  return true;
}

static void mfrc522_send_text(const char *text)
{
  if (!text) {
    command_send_ok(NULL, 0);
    return;
  }
  (void)CDC_SendResponsePkt_FS((uint8_t *)text, (uint16_t)strlen(text), 100);
}

static void mfrc522_cmd_init(void)
{
  mfrc522_ensure_initialized();
  if (!mfrc522_is_present()) {
    mfrc522_send_text("ERR: MFRC522 not detected");
    return;
  }
  command_send_ok(NULL, 0);
}

static bool mfrc522_get_card(u_char tag_type[2], u_char uid[5])
{
  if (!tag_type || !uid) {
    return false;
  }

  u_char status = MFRC522_Request(PICC_REQIDL, tag_type);
  if (status != MI_OK) {
    return false;
  }

  status = MFRC522_Anticoll(uid);
  if (status != MI_OK) {
    return false;
  }

  (void)MFRC522_SelectTag(uid);
  return true;
}

static void mfrc522_cmd_read(int block, int auth, const char *key_str)
{
  mfrc522_ensure_initialized();
  if (!mfrc522_is_present()) {
    mfrc522_send_text("ERR: MFRC522 not detected");
    return;
  }

  uint8_t key_bytes[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  size_t key_len = 0;
  // Treat malformed/short keys as "use default key" to keep the transport simple.
  // (MIFARE default key is 0xFF repeated 6 times.)
  if (parse_hex_bytes_relaxed(key_str, key_bytes, sizeof(key_bytes), &key_len) && key_len == sizeof(key_bytes)) {
    // Parsed successfully into key_bytes.
  } else {
    // Keep default.
    memset(key_bytes, 0xFF, sizeof(key_bytes));
  }

  u_char tag_type[2] = {0};
  u_char uid[5] = {0};
  if (!mfrc522_get_card(tag_type, uid)) {
    mfrc522_send_text("No card detected");
    return;
  }

  u_char status = MFRC522_Auth((u_char)auth, (u_char)block, (u_char *)key_bytes, uid);
  if (status != MI_OK) {
    MFRC522_StopCrypto1();
    mfrc522_send_text("ERR: auth failed");
    return;
  }

  u_char block_data[18] = {0};
  status = MFRC522_Read((u_char)block, block_data);

  MFRC522_StopCrypto1();
  MFRC522_Halt();

  if (status != MI_OK) {
    mfrc522_send_text("ERR: read failed");
    return;
  }

  uint8_t response[2 + 4 + 16] = {0};
  response[0] = tag_type[0];
  response[1] = tag_type[1];
  memcpy(&response[2], uid, 4);
  memcpy(&response[6], block_data, 16);
  (void)CDC_SendResponsePkt_FS(response, sizeof(response), 100);
}

static void mfrc522_cmd_write(int block, int auth, const char *key_str, const char *data_str)
{
  mfrc522_ensure_initialized();
  if (!mfrc522_is_present()) {
    mfrc522_send_text("ERR: MFRC522 not detected");
    return;
  }

  uint8_t key_bytes[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  size_t key_len = 0;
  // Treat malformed/short keys as "use default key" to keep the transport simple.
  if (parse_hex_bytes_relaxed(key_str, key_bytes, sizeof(key_bytes), &key_len) && key_len == sizeof(key_bytes)) {
    // Parsed successfully into key_bytes.
  } else {
    memset(key_bytes, 0xFF, sizeof(key_bytes));
  }

  uint8_t data_bytes[16] = {0};
  size_t data_len = 0;
  if (!parse_hex_bytes_relaxed(data_str, data_bytes, sizeof(data_bytes), &data_len) || data_len != sizeof(data_bytes)) {
    mfrc522_send_text("ERR: data must be 16 bytes");
    return;
  }

  u_char tag_type[2] = {0};
  u_char uid[5] = {0};
  if (!mfrc522_get_card(tag_type, uid)) {
    mfrc522_send_text("No card detected");
    return;
  }

  u_char status = MFRC522_Auth((u_char)auth, (u_char)block, (u_char *)key_bytes, uid);
  if (status != MI_OK) {
    MFRC522_StopCrypto1();
    mfrc522_send_text("ERR: auth failed");
    return;
  }

  status = MFRC522_Write((u_char)block, (u_char *)data_bytes);

  MFRC522_StopCrypto1();
  MFRC522_Halt();

  if (status != MI_OK) {
    mfrc522_send_text("ERR: write failed");
    return;
  }

  mfrc522_send_text("Success");
}

void mfrc522_register_commands(void)
{
  static const cmd_arg_spec_t read_args[] = {
    {.name = "block", .type = CMD_ARG_INT, .required = true},
    {.name = "auth", .type = CMD_ARG_INT, .required = true},
    {.name = "key", .type = CMD_ARG_STRING, .required = true},
    {.name = NULL, .type = CMD_ARG_DONE, .required = false},
  };

  static const cmd_arg_spec_t write_args[] = {
    {.name = "block", .type = CMD_ARG_INT, .required = true},
    {.name = "auth", .type = CMD_ARG_INT, .required = true},
    {.name = "key", .type = CMD_ARG_STRING, .required = true},
    {.name = "data", .type = CMD_ARG_STRING, .required = true},
    {.name = NULL, .type = CMD_ARG_DONE, .required = false},
  };

  static const command_entry_t mfrc522_command_table[] = {
    {.verb = "rfid init", .args = NULL, .handler = (void *)mfrc522_cmd_init},
    {.verb = "rfid read", .args = read_args, .handler = (void *)mfrc522_cmd_read},
    {.verb = "rfid write", .args = write_args, .handler = (void *)mfrc522_cmd_write},
  };

  (void)command_registry_add_table(mfrc522_command_table,
                                  sizeof(mfrc522_command_table) / sizeof(mfrc522_command_table[0]));
}
