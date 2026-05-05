/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.files;

public interface RepositoryCallback<T> {
    void onSuccess(T value);

    void onError(String message);
}
