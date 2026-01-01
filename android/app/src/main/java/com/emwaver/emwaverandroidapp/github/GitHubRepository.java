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

package com.emwaver.emwaverandroidapp.github;

public class GitHubRepository {
    public final String name;
    public final String owner;
    public final String fullName;
    public final String description;
    public final String defaultBranch;
    
    public GitHubRepository(String name, String owner, String fullName, String description, String defaultBranch) {
        this.name = name;
        this.owner = owner;
        this.fullName = fullName;
        this.description = description;
        this.defaultBranch = defaultBranch;
    }
}
