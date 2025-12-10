/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2024 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "usb_device.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include <stdio.h>
#include "usbd_cdc_if.h"
#include "MFRC522.h"
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define READ_BYTE 		0x30
#define READ_BURST      0xC0            //read burst
#define WRITE_BURST     0x40            //write burst
#define GDO_OUTPUT		1
#define GDO_INPUT 		0

#define CDC_TIMEOUT 100

#define MAX_BLOCKS 64
#define BYTES_PER_BLOCK 16
/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
SPI_HandleTypeDef hspi1;

TIM_HandleTypeDef htim1;
TIM_HandleTypeDef htim2;
TIM_HandleTypeDef htim3;

/* USER CODE BEGIN PV */
uint16_t samplerPin;
volatile uint32_t selectedChannel = TIM_CHANNEL_3; // Default to channel 3 for backward compatibility

uint8_t * bulk_packet = NULL;
size_t bulk_packet_len = 0;

volatile uint8_t* bufferCircular = NULL;
volatile uint8_t* bufferA = NULL;
volatile uint8_t* bufferB = NULL;
volatile uint8_t* currentBuffer = NULL;
volatile uint8_t* transmitBuffer = NULL;
volatile int bufferIndex = 0;
volatile uint8_t bufferReady = 0;
volatile CDC_Buffer_Type cdc_buf_type = CDC_BUFFER_PACKET;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
static void MX_GPIO_Init(void);
static void MX_TIM2_Init(void);
static void MX_TIM1_Init(void);
static void MX_TIM3_Init(void);
static void MX_SPI1_Init(void);
/* USER CODE BEGIN PFP */
void startPWM_TIM2(uint32_t channel);
void stopPWM_TIM2(uint32_t channel);
/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

void startPWM_TIM2_CH3() {
    // Enable the timer first
    TIM2->CR1 |= TIM_CR1_CEN;
    // Enable the channel with current duty cycle
    TIM2->CCER |= TIM_CCER_CC3E;
}

void stopPWM_TIM2_CH3() {
    // Disable only the channel, keep timer running
    TIM2->CCER &= ~TIM_CCER_CC3E;
}

void ISR_Sampler_raw() {
    static uint8_t bitIndex = 0;
    static uint8_t currentByte = 0;

    // Sample the configurable pin
    uint8_t pin_state = HAL_GPIO_ReadPin(GPIOA, samplerPin);

    if (pin_state) {
        currentByte |= (1 << bitIndex);
    } else {
        currentByte &= ~(1 << bitIndex);
    }

    bitIndex++;
    if (bitIndex >= 8) {
        currentBuffer[bufferIndex] = currentByte;
        bufferIndex++;
        bitIndex = 0;
        currentByte = 0;

        if (bufferIndex >= 64) {
            transmitBuffer = currentBuffer;
            currentBuffer = (currentBuffer == bufferA) ? bufferB : bufferA;
            bufferIndex = 0;
            bufferReady = 1;
        }
    }
}

void ISR_Sampler_writing() {
    static uint8_t bitIndex = 0;
    static uint8_t currentByte = 0;

    // Check if there is data available in the buffer
    if (CDC_GetRxBufferBytesAvailable_FS() > 0) {
        // If this is the first bit of the byte, read the next byte from the buffer
        if (bitIndex == 0) {
            CDC_ReadRxBuffer_FS(&currentByte, 1); // Assume function returns only 1 byte
        }

        if (currentByte & (1 << bitIndex)) {
            startPWM_TIM2(selectedChannel);
        } else {
            stopPWM_TIM2(selectedChannel);
        }

        // Increment bit index and check if we have processed the whole byte
        bitIndex++;
        if (bitIndex > 7) {
            bitIndex = 0; // Reset bit index back to the LSB for the next byte
        }
    }
    else {
        stopPWM_TIM2(selectedChannel);
    }
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim){
    if(htim == &htim3){
        switch (CDC_GetBufferType_FS()) {
            case CDC_BUFFER_CIRCULAR:
            	ISR_Sampler_writing();
                break;
            case CDC_BUFFER_DOUBLE:
                ISR_Sampler_raw();
                break;
            case CDC_BUFFER_PACKET:
            default:
                // Handle the idle case or unknown state if necessary
                break;
        }
    }
}

void writeReg(uint8_t addr, uint8_t value) {
    uint8_t address = addr; // Clear the read bit
    uint8_t val = value;
    HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_RESET);
    HAL_SPI_Transmit(&hspi1, &address, 1, HAL_MAX_DELAY);
    HAL_SPI_Transmit(&hspi1, &val, 1, HAL_MAX_DELAY);
    HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);
}

uint8_t readReg(uint8_t addr){
	uint8_t reading;
	uint8_t address = addr | 0x80;
	uint8_t zero = 0x00;
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_RESET);
	HAL_SPI_TransmitReceive(&hspi1, &address, &reading, 1, HAL_MAX_DELAY);
	HAL_SPI_TransmitReceive(&hspi1, &zero, &reading, 1, HAL_MAX_DELAY);
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);
	return reading;
}

uint8_t spiStrobe (uint8_t value) {
	uint8_t status;
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_RESET);
	HAL_SPI_TransmitReceive (&hspi1, &value, &status, 1, HAL_MAX_DELAY);
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);
	return status;
}

uint8_t writeBurstReg(uint8_t addr, uint8_t *buffer, uint8_t num){
	uint8_t i, temp, status;
	temp = addr | WRITE_BURST;
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_RESET);
	HAL_SPI_TransmitReceive(&hspi1, &temp, &status, 1, HAL_MAX_DELAY);
	for (i = 0; i < num; i++){
	 HAL_SPI_Transmit (&hspi1, &buffer[i], 1, HAL_MAX_DELAY);
	}
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);
	return status;
}

void readBurstReg(uint8_t addr, uint8_t *buffer, uint8_t num){
	uint8_t temp;
	temp = addr | READ_BURST;
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_RESET);
	HAL_SPI_Transmit (&hspi1, &temp, 1, HAL_MAX_DELAY);
	HAL_SPI_Receive (&hspi1, buffer, num, HAL_MAX_DELAY);
	HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);
}

uint32_t getCurrentFrequency() {

    uint32_t timerClock = 48000000;  // Assuming the timer clock is 48 MHz
    uint32_t period = TIM2->ARR;     // Read the current period value

    // Calculate the current frequency
    uint32_t frequency = timerClock / (period + 1);
    uint8_t responsePacket[4]; // 4 bytes for the frequency
	responsePacket[0] = (uint8_t)(frequency >> 24); // Frequency high byte
	responsePacket[1] = (uint8_t)(frequency >> 16) & 0xFF; // Frequency middle byte
	responsePacket[2] = (uint8_t)(frequency >> 8) & 0xFF; // Frequency low byte
	responsePacket[3] = (uint8_t)frequency & 0xFF; // Frequency low byte

    CDC_SendResponsePkt_FS(responsePacket, 4, 100); // Adjust the timeout as needed

    return frequency;
}

void changeFrequency(uint32_t desiredFrequency) {
    uint32_t timerClock = 48000000;  // Assuming the timer clock is 48 MHz
    uint32_t period;

    // Calculate the period for the desired frequency
    period = timerClock / desiredFrequency - 1;

    // Check if the calculated period is within the valid range
    if (period > 0xFFFF) {
        // Handle error: desired frequency is too low to achieve with the current prescaler
        return;
    }

    // Stop the timer before making changes
    HAL_TIM_PWM_Stop(&htim2, TIM_CHANNEL_3);

    // Directly set the timer period
    TIM2->ARR = period;

    // Directly set the PWM channel duty cycle (pulse width)
    TIM2->CCR3 = period / 2;  // Assuming 50% duty cycle
    // Generate an update event to update the shadow registers
    TIM2->EGR = TIM_EGR_UG;

    // Restart the PWM generation
    HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_3);

    // Optionally, retrieve and send back the current frequency to confirm the change
    getCurrentFrequency();
}

void delay_us(uint32_t microseconds)
{
    // Assuming TIM1 has been initialized elsewhere in your code
    // with Prescaler = 48 - 1 and Period = 0xFFFF - 1

    // Reset the counter value
    __HAL_TIM_SET_COUNTER(&htim1, 0);

    // Start the timer
    HAL_TIM_Base_Start(&htim1);

    // Wait until the timer reaches the specified microseconds
    while (__HAL_TIM_GET_COUNTER(&htim1) < microseconds);

    // Stop the timer
    HAL_TIM_Base_Stop(&htim1);
}

void sendPulse(uint32_t burstLength, uint32_t spaceLength)
{
	// Start PWM output for the burst length
	startPWM_TIM2_CH3(); // Start PWM
	delay_us(burstLength); // Delay for the burst duration in microseconds

	// Stop PWM output for the space length
	stopPWM_TIM2_CH3(); // Stop PWM
	delay_us(spaceLength); // Delay for the space duration in microseconds
}

void free_bulk_packet(){
	if (bulk_packet != NULL) {
	    free(bulk_packet);
	    bulk_packet = NULL; // Ensure the pointer is set to NULL after freeing
	}
}

void configurePin(uint16_t pin, uint32_t mode, uint32_t pull) {
    GPIO_InitTypeDef GPIO_InitStruct = {0};

    // Enable the GPIOA clock
    __HAL_RCC_GPIOA_CLK_ENABLE();

    // Configure the GPIO pin
    GPIO_InitStruct.Pin = pin;
    GPIO_InitStruct.Mode = mode;
    GPIO_InitStruct.Pull = pull;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_HIGH;
    
    // If mode is alternate function, set the alternate function for TIM2
    if (mode == GPIO_MODE_AF_PP) {
        GPIO_InitStruct.Alternate = GPIO_AF2_TIM2;
    }
    
    HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
}

void setDutyCycle_TIM2_CH3(uint8_t percentage) {
    // Ensure percentage is between 1 and 100
    if (percentage < 1) percentage = 1;
    if (percentage > 100) percentage = 100;

    // Calculate the new CCR value
    uint32_t period = TIM2->ARR;
    uint32_t new_ccr = (period * percentage) / 100;

    // Set the new CCR value
    TIM2->CCR3 = new_ccr;
}

void requestCard() {
    uint8_t response[6] = {0};
    u_char status;
    u_char TagType[2];

    status = MFRC522_Request(PICC_REQIDL, TagType);

    response[0] = status;
    response[1] = TagType[0];
    response[2] = TagType[1];
    // Fill remaining bytes with zeros

    CDC_Transmit_FS(response, 6);
}

void antiCollision() {
    uint8_t response[5] = {69, 69, 69, 69, 69};
    u_char status;
    u_char cardstr[5];

    status = MFRC522_Anticoll(cardstr);

    response[0] = status;
    if (status == MI_OK) {
        for (int i = 0; i < 4; i++) {
            response[i+1] = cardstr[i];
        }
    }

    CDC_Transmit_FS(response, 5);
}

void setPinMode(uint8_t port, uint8_t pin, uint8_t mode) {
    GPIO_TypeDef* gpio_port;
    if (port == 0) {
        gpio_port = GPIOA;
    } else if (port == 1) {
        gpio_port = GPIOB;
    } else {
        // Invalid port; handle error as needed
        return;
    }

    // Calculate the actual pin number for PB5-PB7
    if (gpio_port == GPIOB && pin >= 5 && pin <= 7) {
        // No adjustment needed if pins are directly mapped
    } else if (gpio_port == GPIOA && pin > 7) {
        // Handle invalid pin for GPIOA
        return;
    }

    GPIO_InitTypeDef GPIO_InitStruct = {0};
    GPIO_InitStruct.Pin = 1 << pin;
    if (mode == 0) {
        GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
    } else if (mode == 1) {
        GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
    }
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(gpio_port, &GPIO_InitStruct);
}

void startPWM_TIM2(uint32_t channel) {
    // Enable the timer first
    TIM2->CR1 |= TIM_CR1_CEN;
    // Enable the specified channel
    switch(channel) {
        case TIM_CHANNEL_1:
            TIM2->CCER |= TIM_CCER_CC1E;
            break;
        case TIM_CHANNEL_2:
            TIM2->CCER |= TIM_CCER_CC2E;
            break;
        case TIM_CHANNEL_3:
            TIM2->CCER |= TIM_CCER_CC3E;
            break;
        case TIM_CHANNEL_4:
            TIM2->CCER |= TIM_CCER_CC4E;
            break;
    }
}

void stopPWM_TIM2(uint32_t channel) {
    // Disable the specified channel, keep timer running
    switch(channel) {
        case TIM_CHANNEL_1:
            TIM2->CCER &= ~TIM_CCER_CC1E;
            break;
        case TIM_CHANNEL_2:
            TIM2->CCER &= ~TIM_CCER_CC2E;
            break;
        case TIM_CHANNEL_3:
            TIM2->CCER &= ~TIM_CCER_CC3E;
            break;
        case TIM_CHANNEL_4:
            TIM2->CCER &= ~TIM_CCER_CC4E;
            break;
    }
}

void setDutyCycle_TIM2(uint32_t channel, uint8_t percentage) {
    if (percentage < 1) percentage = 1;
    if (percentage > 100) percentage = 100;

    uint32_t period = TIM2->ARR;
    uint32_t new_ccr = (period * percentage) / 100;

    // Set the CCR value for the specified channel
    switch(channel) {
        case TIM_CHANNEL_1:
            TIM2->CCR1 = new_ccr;
            break;
        case TIM_CHANNEL_2:
            TIM2->CCR2 = new_ccr;
            break;
        case TIM_CHANNEL_3:
            TIM2->CCR3 = new_ccr;
            break;
        case TIM_CHANNEL_4:
            TIM2->CCR4 = new_ccr;
            break;
    }
}

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  MX_TIM2_Init();
  MX_TIM1_Init();
  MX_USB_DEVICE_Init();
  MX_TIM3_Init();
  MX_SPI1_Init();
  /* USER CODE BEGIN 2 */

  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1) {
	  	  if (bulk_packet[0] == '!') { //write register
	  	      writeReg(bulk_packet[1], bulk_packet[2]);
	  	      uint8_t reading = readReg(bulk_packet[1]);
	  	      CDC_SendResponsePkt_FS(&reading, 1, CDC_TIMEOUT);
	  	      free_bulk_packet();
	  	  } else if (bulk_packet[0] == '?') { //read register
	  	      uint8_t reading = readReg(bulk_packet[1]);
	  	      CDC_SendResponsePkt_FS(&reading, 1, CDC_TIMEOUT);
	  	      free_bulk_packet();
	  	  } else if (bulk_packet[0] == '%') { //strobe
	  	      uint8_t status = spiStrobe(bulk_packet[1]);
	  	      CDC_SendResponsePkt_FS(&status, 1, CDC_TIMEOUT);
	  	      free_bulk_packet();
	  	  } else if(bulk_packet[0] == '>'){ //burst write <[addr][len][data]
	  		  uint8_t addr = bulk_packet[1];
	  		  uint8_t len = bulk_packet[2];
	  		  uint8_t buf[len];
	  		  uint8_t status;
	  		  for(uint8_t i = 0; i < len; i++)
	  			  buf[i] = bulk_packet[3+i];
	  		  status = writeBurstReg(addr, buf, len);
	  		  CDC_SendResponsePkt_FS(&status, 1, CDC_TIMEOUT);
	  		  free_bulk_packet();
	  	  } else if(bulk_packet[0] == '<'){ //burst read <[addr][len]
	  		  uint8_t addr = bulk_packet[1];
	  		  uint8_t len = bulk_packet[2];
	  		  uint8_t buf[len];
	  		  readBurstReg(addr, buf, len);
	  		  CDC_SendResponsePkt_FS(buf, len, CDC_TIMEOUT);
	  		  free_bulk_packet();
	  	  } else if (bulk_packet[0] == 'r' && bulk_packet[1] == 'a' && bulk_packet[2] == 'w') {
			  // Configure the pin as input before sampling
			  // Use NOPULL for A1, PULLDOWN for other pins
			  uint32_t pull = (bulk_packet[3] == GPIO_PIN_1) ? GPIO_NOPULL : GPIO_PULLDOWN;
			  configurePin(bulk_packet[3], GPIO_MODE_INPUT, pull);
			  samplerPin = bulk_packet[3];

			  // Setup buffers
			  bufferA = (uint8_t*)malloc(64 * sizeof(uint8_t));
			  bufferB = (uint8_t*)malloc(64 * sizeof(uint8_t));
			  currentBuffer = bufferA;
			  transmitBuffer = NULL;
			  bufferIndex = 0;
			  bufferReady = 0;
			  CDC_SetBufferType_FS(CDC_BUFFER_DOUBLE);

			  // Start sampling
			  HAL_TIM_Base_Start_IT(&htim3);
			  while (!(bulk_packet[0] == 's')) {
				  if (bufferReady == 1) {
					  while (CDC_Transmit_FS((uint8_t*)transmitBuffer, 64));
					  bufferReady = 0;
				  }
			  }

			  // Stop sampling and clean up
			  HAL_TIM_Base_Stop_IT(&htim3);
			  CDC_SetBufferType_FS(CDC_BUFFER_PACKET);
			  free((void*)bufferA);
			  free((void*)bufferB);
			  bufferA = NULL;
			  bufferB = NULL;
			  currentBuffer = NULL;
			  transmitBuffer = NULL;
			  free_bulk_packet();
		  } else if (bulk_packet[0] == 't' && bulk_packet[1] == 'r' && bulk_packet[2] == 'a' && bulk_packet[3] == 'n') {
			  uint8_t pin_number = bulk_packet[4]; // 0-3 for PA0-PA3
			  uint8_t duty_cycle = bulk_packet[5];
			  uint32_t tim_channel;
			  uint16_t gpio_pin;
			  
			  // Map pin number to TIM channel and GPIO pin
			  switch(pin_number) {
				  case 0:
					  tim_channel = TIM_CHANNEL_1;
					  gpio_pin = GPIO_PIN_0;
					  break;
				  case 1:
					  tim_channel = TIM_CHANNEL_2;
					  gpio_pin = GPIO_PIN_1;
					  break;
				  case 2:
					  tim_channel = TIM_CHANNEL_3;
					  gpio_pin = GPIO_PIN_2;
					  break;
				  case 3:
					  tim_channel = TIM_CHANNEL_4;
					  gpio_pin = GPIO_PIN_3;
					  break;
				  default:
					  free_bulk_packet();
					  continue;
			  }

			  // Configure the selected pin for PWM output
			  configurePin(gpio_pin, GPIO_MODE_AF_PP, GPIO_PULLDOWN);
			  
			  // Set the duty cycle for the selected channel
			  setDutyCycle_TIM2(tim_channel, duty_cycle);
			  
			  // Set the selected channel for the ISR
			  selectedChannel = tim_channel;  // Need to make selectedChannel accessible to ISR
			  
			  // Start PWM on the selected channel
			  HAL_TIM_PWM_Start(&htim2, tim_channel);

			  CDC_InitRxBuffer_FS();
			  CDC_SetBufferType_FS(CDC_BUFFER_CIRCULAR);
			  while (CDC_GetRxBufferBytesAvailable_FS() < 250); // wait for half the buffer is filled
			  HAL_TIM_Base_Start_IT(&htim3);
			  while (CDC_GetRxBufferBytesAvailable_FS() != 0); // wait for the signal transmission to be over
			  CDC_SetBufferType_FS(CDC_BUFFER_PACKET);

			  HAL_TIM_Base_Stop_IT(&htim3);
			  stopPWM_TIM2(tim_channel);
			  CDC_FlushRxBuffer_FS();
			  CDC_FreeRxBuffer_FS();

			  free_bulk_packet();
		  } else if (strncmp((char*)bulk_packet, "gpio", 4) == 0) { // GPIO command
			    uint8_t port = bulk_packet[4];
			    uint8_t pin = bulk_packet[5];
			    uint8_t action = bulk_packet[6]; // 'R' for Read, 'W' for Write
			    uint8_t value = bulk_packet[7];  // Only used for Write
			    GPIO_TypeDef* gpio_port = (port == 0) ? GPIOA : GPIOB;
			    uint16_t gpio_pin = 1 << pin;
			    uint8_t response = 0;
			    if (action == 'R') {
			        setPinMode(port, pin, 0);
			        response = HAL_GPIO_ReadPin(gpio_port, gpio_pin);
			    }
			    else if (action == 'W') {
			        setPinMode(port, pin, 1);
			        HAL_GPIO_WritePin(gpio_port, gpio_pin, (GPIO_PinState)value);
			        response = HAL_GPIO_ReadPin(gpio_port, gpio_pin);
			    }
			    CDC_Transmit_FS(&response, 1);
			    free_bulk_packet();
			} else if (bulk_packet[0] == 'r' && bulk_packet[1] == 'e' && bulk_packet[2] == 'a' && bulk_packet[3] == 'd') {
			    uint8_t blockAddr = bulk_packet[4]; // The block address to read
			    uint8_t authMode = bulk_packet[5];  // Authentication mode (PICC_AUTHENT1A or PICC_AUTHENT1B)
			    uint8_t keyA[6];  // Key A is 6 bytes
			    memcpy(keyA, &bulk_packet[6], 6);  // Copy the key from the input

			    uint8_t status;
			    uint8_t bufferATQA[2];
			    uint8_t CardUID[10];
			    uint8_t responsePacket[40]; // Increased size to accommodate all data
			    uint8_t responseIndex = 0;

			    MFRC522_Init();

			    // Step 1: Request (get card type)
			    status = MFRC522_Request(PICC_REQIDL, bufferATQA);
			    if (status != MI_OK) {
			        uint8_t errorMsg[] = "No card detected";
			        CDC_SendResponsePkt_FS(errorMsg, sizeof(errorMsg) - 1, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Add card type to response
			    responsePacket[responseIndex++] = bufferATQA[0];
			    responsePacket[responseIndex++] = bufferATQA[1];

			    // Step 2: Anticollision (get UID)
			    status = MFRC522_Anticoll(CardUID);
			    if (status != MI_OK) {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Anticollision failed", 20);
			        CDC_SendResponsePkt_FS(responsePacket, responseIndex + 20, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Add UID to response (assuming 4-byte UID, adjust if necessary)
			    for (int i = 0; i < 4; i++) {
			        responsePacket[responseIndex++] = CardUID[i];
			    }

			    // Step 3: Select Tag
			    status = MFRC522_SelectTag(CardUID);
			    if (status == 0) {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Card selection failed", 21);
			        CDC_SendResponsePkt_FS(responsePacket, responseIndex + 21, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Step 4: Authentication
			    status = MFRC522_Auth(authMode, blockAddr, keyA, CardUID);
			    if (status != MI_OK) {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Authentication failed", 21);
			        CDC_SendResponsePkt_FS(responsePacket, responseIndex + 21, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Step 5: Read the block
			    uint8_t buffer[16];
			    status = MFRC522_Read(blockAddr, buffer);
			    if (status == MI_OK) {
			        responsePacket[responseIndex++] = 0x00; // Success indicator
			        // Add block data to response
			        for (int i = 0; i < 16; i++) {
			            responsePacket[responseIndex++] = buffer[i];
			        }
			    } else {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Read failed", 11);
			        responseIndex += 11;
			    }

			    CDC_SendResponsePkt_FS(responsePacket, responseIndex, CDC_TIMEOUT);

			    // Step 6: Stop encryption
			    MFRC522_StopCrypto1();

			    // Free the bulk packet buffer
			    free_bulk_packet();
			} else if (bulk_packet[0] == 'w' && bulk_packet[1] == 'r' && bulk_packet[2] == 'i' && bulk_packet[3] == 't' && bulk_packet[4] == 'e') {
			    uint8_t blockAddr = bulk_packet[5]; // Block address to write to
			    uint8_t authMode = bulk_packet[6]; // Authentication mode (PICC_AUTHENT1A or PICC_AUTHENT1B)
			    uint8_t key[6]; // Key A or Key B
			    memcpy(key, &bulk_packet[7], 6); // Copy the key from the input
			    uint8_t writeData[16]; // Data to write to the block
			    memcpy(writeData, &bulk_packet[13], 16); // Copy the data from the input

			    uint8_t status;
			    uint8_t bufferATQA[2];
			    uint8_t CardUID[10];
			    uint8_t responsePacket[40]; // Increased size to accommodate all data
			    uint8_t responseIndex = 0;

			    MFRC522_Init();

			    // Step 1: Request (get card type)
			    status = MFRC522_Request(PICC_REQIDL, bufferATQA);
			    if (status != MI_OK) {
			        uint8_t errorMsg[] = "No card detected";
			        CDC_SendResponsePkt_FS(errorMsg, sizeof(errorMsg) - 1, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Add card type to response
			    responsePacket[responseIndex++] = bufferATQA[0];
			    responsePacket[responseIndex++] = bufferATQA[1];

			    // Step 2: Anticollision (get UID)
			    status = MFRC522_Anticoll(CardUID);
			    if (status != MI_OK) {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Anticollision failed", 20);
			        CDC_SendResponsePkt_FS(responsePacket, responseIndex + 20, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Add UID to response (assuming 4-byte UID, adjust if necessary)
			    for (int i = 0; i < 4; i++) {
			        responsePacket[responseIndex++] = CardUID[i];
			    }

			    // Step 3: Select Tag
			    status = MFRC522_SelectTag(CardUID);
			    if (status == 0) {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Select tag failed", 17);
			        CDC_SendResponsePkt_FS(responsePacket, responseIndex + 17, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Step 4: Authenticate with Key A or Key B
			    status = MFRC522_Auth(authMode, blockAddr, key, CardUID);
			    if (status != MI_OK) {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Authentication failed", 21);
			        CDC_SendResponsePkt_FS(responsePacket, responseIndex + 21, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Step 5: Write data to the block
			    status = MFRC522_Write(blockAddr, writeData);
			    if (status != MI_OK) {
			        responsePacket[responseIndex++] = 0xFF; // Error indicator
			        memcpy(&responsePacket[responseIndex], "Write failed", 12);
			        CDC_SendResponsePkt_FS(responsePacket, responseIndex + 12, CDC_TIMEOUT);
			        free_bulk_packet();
			        continue;
			    }

			    // Step 6: Stop encryption on PCD
			    MFRC522_StopCrypto1();

			    // Send success response
			    uint8_t successMsg[] = "Success";
			    CDC_SendResponsePkt_FS(successMsg, sizeof(successMsg) - 1, CDC_TIMEOUT);
			    free_bulk_packet();
			}
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
    }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};
  RCC_PeriphCLKInitTypeDef PeriphClkInit = {0};

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI48;
  RCC_OscInitStruct.HSI48State = RCC_HSI48_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_NONE;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_HSI48;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_1) != HAL_OK)
  {
    Error_Handler();
  }
  PeriphClkInit.PeriphClockSelection = RCC_PERIPHCLK_USB;
  PeriphClkInit.UsbClockSelection = RCC_USBCLKSOURCE_HSI48;

  if (HAL_RCCEx_PeriphCLKConfig(&PeriphClkInit) != HAL_OK)
  {
    Error_Handler();
  }
}

/**
  * @brief SPI1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_SPI1_Init(void)
{

  /* USER CODE BEGIN SPI1_Init 0 */

  /* USER CODE END SPI1_Init 0 */

  /* USER CODE BEGIN SPI1_Init 1 */

  /* USER CODE END SPI1_Init 1 */
  /* SPI1 parameter configuration*/
  hspi1.Instance = SPI1;
  hspi1.Init.Mode = SPI_MODE_MASTER;
  hspi1.Init.Direction = SPI_DIRECTION_2LINES;
  hspi1.Init.DataSize = SPI_DATASIZE_8BIT;
  hspi1.Init.CLKPolarity = SPI_POLARITY_LOW;
  hspi1.Init.CLKPhase = SPI_PHASE_1EDGE;
  hspi1.Init.NSS = SPI_NSS_SOFT;
  hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_64;
  hspi1.Init.FirstBit = SPI_FIRSTBIT_MSB;
  hspi1.Init.TIMode = SPI_TIMODE_DISABLE;
  hspi1.Init.CRCCalculation = SPI_CRCCALCULATION_DISABLE;
  hspi1.Init.CRCPolynomial = 7;
  hspi1.Init.CRCLength = SPI_CRC_LENGTH_DATASIZE;
  hspi1.Init.NSSPMode = SPI_NSS_PULSE_ENABLE;
  if (HAL_SPI_Init(&hspi1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN SPI1_Init 2 */

  /* USER CODE END SPI1_Init 2 */

}

/**
  * @brief TIM1 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM1_Init(void)
{

  /* USER CODE BEGIN TIM1_Init 0 */

  /* USER CODE END TIM1_Init 0 */

  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};

  /* USER CODE BEGIN TIM1_Init 1 */

  /* USER CODE END TIM1_Init 1 */
  htim1.Instance = TIM1;
  htim1.Init.Prescaler = 48-1;
  htim1.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim1.Init.Period = 0xFFFF - 1;
  htim1.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim1.Init.RepetitionCounter = 0;
  htim1.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim1) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim1, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim1, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM1_Init 2 */

  /* USER CODE END TIM1_Init 2 */

}

/**
  * @brief TIM2 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM2_Init(void)
{

  /* USER CODE BEGIN TIM2_Init 0 */

  /* USER CODE END TIM2_Init 0 */

  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};
  TIM_OC_InitTypeDef sConfigOC = {0};

  /* USER CODE BEGIN TIM2_Init 1 */

  /* USER CODE END TIM2_Init 1 */
  htim2.Instance = TIM2;
  htim2.Init.Prescaler = 0;
  htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim2.Init.Period = 1263-1;
  htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim2, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  if (HAL_TIM_PWM_Init(&htim2) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim2, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sConfigOC.OCMode = TIM_OCMODE_PWM1;
  sConfigOC.Pulse = (1263-1)/2;
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_3) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM2_Init 2 */
  // Configure Channel 1 (PA0)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_1) != HAL_OK)
  {
    Error_Handler();
  }

  // Configure Channel 2 (PA1)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_2) != HAL_OK)
  {
    Error_Handler();
  }

  // Configure Channel 3 (PA2)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_3) != HAL_OK)
  {
    Error_Handler();
  }

  // Configure Channel 4 (PA3)
  if (HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_4) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE END TIM2_Init 2 */
  HAL_TIM_MspPostInit(&htim2);

}

/**
  * @brief TIM3 Initialization Function
  * @param None
  * @retval None
  */
static void MX_TIM3_Init(void)
{

  /* USER CODE BEGIN TIM3_Init 0 */

  /* USER CODE END TIM3_Init 0 */

  TIM_ClockConfigTypeDef sClockSourceConfig = {0};
  TIM_MasterConfigTypeDef sMasterConfig = {0};

  /* USER CODE BEGIN TIM3_Init 1 */

  /* USER CODE END TIM3_Init 1 */
  htim3.Instance = TIM3;
  htim3.Init.Prescaler = 0;
  htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim3.Init.Period = 480-1;
  htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim3) != HAL_OK)
  {
    Error_Handler();
  }
  sClockSourceConfig.ClockSource = TIM_CLOCKSOURCE_INTERNAL;
  if (HAL_TIM_ConfigClockSource(&htim3, &sClockSourceConfig) != HAL_OK)
  {
    Error_Handler();
  }
  sMasterConfig.MasterOutputTrigger = TIM_TRGO_RESET;
  sMasterConfig.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
  if (HAL_TIMEx_MasterConfigSynchronization(&htim3, &sMasterConfig) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN TIM3_Init 2 */

  /* USER CODE END TIM3_Init 2 */

}

/**
  * @brief GPIO Initialization Function
  * @param None
  * @retval None
  */
static void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
/* USER CODE BEGIN MX_GPIO_Init_1 */
/* USER CODE END MX_GPIO_Init_1 */

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(NSS_RFID_GPIO_Port, NSS_RFID_Pin, GPIO_PIN_SET);

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(RESET_GPIO_Port, RESET_Pin, GPIO_PIN_RESET);

  /*Configure GPIO pin : IR_RX_Pin */
  GPIO_InitStruct.Pin = IR_RX_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(IR_RX_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : NSS_RFID_Pin */
  GPIO_InitStruct.Pin = NSS_RFID_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(NSS_RFID_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : RESET_Pin */
  GPIO_InitStruct.Pin = RESET_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(RESET_GPIO_Port, &GPIO_InitStruct);

/* USER CODE BEGIN MX_GPIO_Init_2 */
/* USER CODE END MX_GPIO_Init_2 */
}

/* USER CODE BEGIN 4 */

/* USER CODE END 4 */

/**
  * @brief  This function is executed in case of error occurrence.
  * @retval None
  */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}

#ifdef  USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
