/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.files;

public class FileRepositoryException extends Exception {
    public FileRepositoryException(String message) {
        super(message);
    }

    public FileRepositoryException(String message, Throwable cause) {
        super(message, cause);
    }
}
