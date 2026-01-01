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

import SwiftUI

private struct FlashVectorShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()

        // Android drawable: android/app/src/main/res/drawable/ic_flash_black_24dp.xml
        // viewBox: 0 0 24 24
        path.move(to: CGPoint(x: 12.7071, y: 2.29289))
        path.addCurve(
            to: CGPoint(x: 11.2929, y: 2.29289),
            control1: CGPoint(x: 12.3166, y: 1.90237),
            control2: CGPoint(x: 11.6834, y: 1.90237)
        )
        path.addLine(to: CGPoint(x: 6.29289, y: 7.29289))
        path.addCurve(
            to: CGPoint(x: 6.29289, y: 8.70711),
            control1: CGPoint(x: 5.90237, y: 7.68342),
            control2: CGPoint(x: 5.90237, y: 8.31658)
        )
        path.addCurve(
            to: CGPoint(x: 7.70711, y: 8.70711),
            control1: CGPoint(x: 6.68342, y: 9.09763),
            control2: CGPoint(x: 7.31658, y: 9.09763)
        )
        path.addLine(to: CGPoint(x: 11, y: 5.41421))
        path.addLine(to: CGPoint(x: 11, y: 18))
        path.addCurve(
            to: CGPoint(x: 12, y: 19),
            control1: CGPoint(x: 11, y: 18.5523),
            control2: CGPoint(x: 11.4477, y: 19)
        )
        path.addCurve(
            to: CGPoint(x: 13, y: 18),
            control1: CGPoint(x: 12.5523, y: 19),
            control2: CGPoint(x: 13, y: 18.5523)
        )
        path.addLine(to: CGPoint(x: 13, y: 5.41421))
        path.addLine(to: CGPoint(x: 16.2929, y: 8.70711))
        path.addCurve(
            to: CGPoint(x: 17.7071, y: 8.70711),
            control1: CGPoint(x: 16.6834, y: 9.09763),
            control2: CGPoint(x: 17.3166, y: 9.09763)
        )
        path.addCurve(
            to: CGPoint(x: 17.7071, y: 7.29289),
            control1: CGPoint(x: 18.0976, y: 8.31658),
            control2: CGPoint(x: 18.0976, y: 7.68342)
        )
        path.addLine(to: CGPoint(x: 12.7071, y: 2.29289))
        path.closeSubpath()

        path.move(to: CGPoint(x: 5.25, y: 20.5))
        path.addCurve(
            to: CGPoint(x: 4.5, y: 21.25),
            control1: CGPoint(x: 4.83579, y: 20.5),
            control2: CGPoint(x: 4.5, y: 20.8358)
        )
        path.addCurve(
            to: CGPoint(x: 5.25, y: 22),
            control1: CGPoint(x: 4.5, y: 21.6642),
            control2: CGPoint(x: 4.83579, y: 22)
        )
        path.addLine(to: CGPoint(x: 18.75, y: 22))
        path.addCurve(
            to: CGPoint(x: 19.5, y: 21.25),
            control1: CGPoint(x: 19.1642, y: 22),
            control2: CGPoint(x: 19.5, y: 21.6642)
        )
        path.addCurve(
            to: CGPoint(x: 18.75, y: 20.5),
            control1: CGPoint(x: 19.5, y: 20.8358),
            control2: CGPoint(x: 19.1642, y: 20.5)
        )
        path.addLine(to: CGPoint(x: 5.25, y: 20.5))
        path.closeSubpath()

        let scaleX = rect.width / 24
        let scaleY = rect.height / 24
        let transform = CGAffineTransform(scaleX: scaleX, y: scaleY)
        return path.applying(transform)
    }
}

struct FlashTabIcon: View {
    var body: some View {
        FlashVectorShape()
            .aspectRatio(1, contentMode: .fit)
            .foregroundStyle(.primary)
            .frame(width: 22, height: 22)
            .accessibilityHidden(true)
    }
}

#Preview {
    FlashTabIcon()
        .padding()
}

