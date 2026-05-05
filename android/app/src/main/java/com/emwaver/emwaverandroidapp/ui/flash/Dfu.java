/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.flash;

import android.util.Log;

import com.emwaver.emwaverandroidapp.USBService;

@SuppressWarnings("unused")
public class Dfu {
    public final static int USB_VENDOR_ID = 1155;   // VID while in DFU mode 0x0483
    public final static int USB_PRODUCT_ID = 57105; // PID while in DFU mode 0xDF11

    public final static int USB_DIR_OUT = 0;
    public final static int USB_DIR_IN = 128;       //0x80
    public final static int DFU_RequestType = 0x21;  // '2' => Class request ; '1' => to interface

    public final static int STATE_IDLE = 0x00;
    public final static int STATE_DETACH = 0x01;
    public final static int STATE_DFU_IDLE = 0x02;
    public final static int STATE_DFU_DOWNLOAD_SYNC = 0x03;
    public final static int STATE_DFU_DOWNLOAD_BUSY = 0x04;
    public final static int STATE_DFU_DOWNLOAD_IDLE = 0x05;
    public final static int STATE_DFU_MANIFEST_SYNC = 0x06;
    public final static int STATE_DFU_MANIFEST = 0x07;
    public final static int STATE_DFU_MANIFEST_WAIT_RESET = 0x08;
    public final static int STATE_DFU_UPLOAD_IDLE = 0x09;
    public final static int STATE_DFU_ERROR = 0x0A;
    public final static int STATE_DFU_UPLOAD_SYNC = 0x91;
    public final static int STATE_DFU_UPLOAD_BUSY = 0x92;

    // DFU Commands, request ID code when using controlTransfers
    public final static int DFU_DETACH = 0x00;
    public final static int DFU_DNLOAD = 0x01;
    public final static int DFU_UPLOAD = 0x02;
    public final static int DFU_GETSTATUS = 0x03;
    public final static int DFU_CLRSTATUS = 0x04;
    public final static int DFU_GETSTATE = 0x05;
    public final static int DFU_ABORT = 0x06;

    public final static String[] DEVICE_STATE = {
            "OK", "errTARGET", "errFILE",
            "errWRITE", "errERASE", "errCHECK_ERASED", "errPROG", "errVERIFY",
            "errADDRESS", "errNOTDONE", "errFIRMWARE", "errVENDOR", "errUSBR",
            "errPOR", "errUNKNOWN", "errSTALLEDPKT"
    };
    public final static String[] DEVICE_STATUS = {
            "appIDLE", "appDETACH", "dfuIDLE",
            "dfuDNLOAD -SYNC", "dfuDNBUSY", "dfuDNLOAD -IDLE", "dfuMANIFEST-SYNC", "dfuMANIFEST",
            "dfuMANIFEST-WAIT-RESET", "dfuUPLOAD -IDLE", "dfuERROR"
    };

    public final static int DFU_REQUEST_TYPE_IN =  0b10100001; // Adjust according to your needs
    public final static int STATE_OK = 0;
    public final static int DFU_REQUEST_TYPE_OUT = 0b00100001; // OUT Endpoint, Class Request, Interface Recipient

    public final static int BLOCK_SIZE = 2048; // wTransferSize

    public USBService usbService;

    public Dfu(USBService usbService) {
        this.usbService = usbService;
    }

    public int getStatus(byte[] buffer) throws Exception {
        int length = usbService.getUsbDeviceConnection().controlTransfer(DFU_REQUEST_TYPE_IN, DFU_GETSTATUS, 0, 0, buffer, 6, 500);
        if (length < 0) {
            throw new Exception("USB Failed during getStatus");
        } else {
            byte state = buffer[1]; // Ensure unsigned byte
            byte status = buffer[4]; // Ensure unsigned byte
            if (state < DEVICE_STATE.length) {
                Log.i("Dfu", "state " + state + ": " + DEVICE_STATE[state]);
            } else {
                Log.i("Dfu", "state " + state + ": OUT OF RANGE");
            }
            Log.i("Dfu", "status " + status + ": " + DEVICE_STATUS[status]);
        }

        return length;
    }

    public int clearStatus() throws Exception  {
        int length = usbService.getUsbDeviceConnection().controlTransfer(DFU_REQUEST_TYPE_OUT, DFU_CLRSTATUS, 0, 0, null, 0, 5000);
        if (length < 0) {
            throw new Exception("error: clear_status() control transfer failed");
        }

        return length;
    }

    public void waitDownloadIdle() throws Exception {
        byte[] status = new byte[6];
        long startTime = System.currentTimeMillis();
        long timeout = 500;

        getStatus(status);
        while (!(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_DOWNLOAD_IDLE)) {
            // Check if timeout has been reached
            if (System.currentTimeMillis() - startTime > timeout) {
                throw new Exception("error: Timeout exceeded while waiting for download idle state");
            }
            clearStatus();
            getStatus(status);
        }
    }

    public void waitUploadIdle() throws Exception {
        byte[] status = new byte[6];
        long startTime = System.currentTimeMillis();
        long timeout = 500;

        getStatus(status);
        while (!(status[4] == STATE_DFU_IDLE || status[4] == STATE_DFU_UPLOAD_IDLE)) {
            // Check if timeout has been reached
            if (System.currentTimeMillis() - startTime > timeout) {
                throw new Exception("error: Timeout exceeded while waiting for download idle state");
            }
            clearStatus();
            getStatus(status);
        }
    }

    public void readBlock(byte[] buffer, int block, int num_bytes) {
        int length = usbService.getUsbDeviceConnection().controlTransfer(DFU_REQUEST_TYPE_IN, DFU_UPLOAD, block, 0, buffer, num_bytes, 500);
        if (length < 0) {
            Log.i("Dfu", "error: read_block() control transfer failed");
        }
    }
}
