package com.emwaver.emwaverandroidapp.files;

public interface RepositoryCallback<T> {
    void onSuccess(T value);

    void onError(String message);
}
