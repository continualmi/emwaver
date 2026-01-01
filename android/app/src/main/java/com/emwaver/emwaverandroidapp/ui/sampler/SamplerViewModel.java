/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.emwaver.emwaverandroidapp.ui.sampler;

import androidx.lifecycle.ViewModel;

public class SamplerViewModel extends ViewModel {
    public int visibleRangeStart = 0;
    public int visibleRangeEnd = 0;
    public int getVisibleRangeStart(){
        return visibleRangeStart;
    }
    public int getVisibleRangeEnd(){
        return visibleRangeEnd;
    }
    public void setVisibleRangeStart(int range){
        visibleRangeStart = range;
    }
    public void setVisibleRangeEnd(int range){
        visibleRangeEnd = range;
    }
}