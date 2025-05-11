import Foundation

/**
 * Swift port of the IRP class from the Android app.
 * Handles parsing IRP definitions and generating IR pulse sequences.
 */
class IRP {
    
    // MARK: - Helper Structures
    
    /// Corresponds to the Value struct
    private struct Value {
        var val: Double
        var bits: Int // 0 for constants, >0 for bitfields, <0 for time units (ms/us)
        
        init() {
            self.val = 0
            self.bits = 0
        }
        
        init(val: Double, bits: Int) {
            self.val = val
            self.bits = bits
        }
    }
    
    /// Operator precedence for parseVal
    private enum OperatorPrecedence: Int {
        case base = 0
        case colon = 1
        case plus = 2
        case times = 3
        case unary = 4
    }
    
    // MARK: - Member Variables
    
    private var frequency: Double = 38400.0
    private var timeBase: Double = 1.0 // microseconds
    private var messageTime: Double = 0.0 // microseconds
    private var digits: [String?] = Array(repeating: nil, count: 16) // Definitions for digits 0-15
    private var prefix: String?
    private var suffix: String?
    private var rPrefix: String? // Repeat prefix
    private var rSuffix: String? // Repeat suffix
    private var msb: Bool = false // First bit is Most Significant Bit
    private var def: [String?] = Array(repeating: nil, count: 26) // Definitions for variables A-Z
    private var value: [Character: Int] = [:] // Current values for variables A-Z
    private var form: String? // Main IRP form string
    private var numberFormat: Int = 0 // (Not directly used in generation)
    
    private var device: [Int] = [-1, -1, -1] // Device range D.S
    private var function: [Int] = [0, 0]  // Current function for iteration
    private var functions: [Int] = [-1, -1, -1, -1] // Function range F.N .. F.N
    private var cumulativeTime: Double = 0.0 // Current time in generated sequence
    private var hexSequence: [Double] = [] // Stores generated pulse/gap durations
    
    // Bit manipulation helpers
    private var mask: [UInt64] = Array(repeating: 0, count: 33)
    private var bitGroup: Int = 2 // Power of 2 (2, 4, 8, 16) for multi-bit digits
    private var pendingBits: Int = 0 // Holds bits being assembled for multi-bit digits
    
    // MARK: - Parser State Helper
    
    private class ParserState {
        let input: String
        var index: String.Index
        
        init(input: String) {
            self.input = input
            self.index = input.startIndex
        }
        
        func peek() -> Character {
            return hasMore() ? input[index] : " "
        }
        
        func consume() -> Character {
            guard hasMore() else { return " " }
            let char = input[index]
            index = input.index(after: index)
            return char
        }
        
        func hasMore() -> Bool {
            return index < input.endIndex
        }
        
        func remaining() -> String {
            return String(input[index...])
        }
    }
    
    // MARK: - Initialization
    
    init() {
        // Initialize value map for A-Z
        for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
            value[c] = 0 // Default value 0
        }
        
        // Precompute masks
        mask[0] = 0
        for ndx in 1..<33 {
            mask[ndx] = 2 * mask[ndx - 1] + 1
        }
    }
    
    // MARK: - Utility Methods
    
    /// Reverses the lower 32 bits of a UInt64 (equivalent to C++ unsigned int reverse)
    private func reverseBits(_ number: UInt64) -> UInt64 {
        var n = number
        n = ((n & 0x55555555) << 1) | ((n >> 1) & 0x55555555)
        n = ((n & 0x33333333) << 2) | ((n >> 2) & 0x33333333)
        n = ((n & 0x0F0F0F0F) << 4) | ((n >> 4) & 0x0F0F0F0F)
        n = ((n & 0x00FF00FF) << 8) | ((n >> 8) & 0x00FF00FF)
        return (n >> 16) | (n << 16)
    }
    
    // MARK: - Core Methods
    
    /**
     Parses the IRP definition from a string
     - Parameter irpDefinition: The IRP definition string
     - Returns: true if parsing was successful, false otherwise
     */
    func readIrpString(_ irpDefinition: String) -> Bool {
        guard !irpDefinition.isEmpty else {
            return false
        }
        
        let lines = irpDefinition.split(whereSeparator: { $0 == "\r" || $0 == "\n" })
        
        for rawLine in lines {
            // Preprocess line: remove comments, convert to uppercase, remove spaces/tabs
            let lineWithoutComment = String(rawLine).split(separator: "'", maxSplits: 1)[0]
            let processedLine = lineWithoutComment.uppercased().replacingOccurrences(of: "[ \t]+", with: "", options: .regularExpression)
            
            if processedLine.isEmpty {
                continue // Skip empty lines
            }
            
            let lineState = ParserState(input: processedLine)
            
            // Recognize Keywords
            if matchAndConsume(lineState, prefix: "FREQUENCY=") {
                let val = parseVal(lineState, precedence: .base)
                self.frequency = val.val
            } else if matchAndConsume(lineState, prefix: "TIMEBASE=") {
                let val = parseVal(lineState, precedence: .base)
                self.timeBase = val.val
            } else if matchAndConsume(lineState, prefix: "MESSAGETIME=") {
                let val = parseVal(lineState, precedence: .base)
                if val.bits == 0 && self.timeBase != 0 {
                    self.messageTime = val.val * self.timeBase
                } else {
                    self.messageTime = val.val
                }
            } else if lineState.peek().isNumber && lineState.input.count > lineState.index.utf16Offset(in: lineState.input) + 1 && 
                      lineState.input[lineState.input.index(lineState.index, offsetBy: 1)] == "=" {
                // Digit definition 0-9
                let digit = Int(String(lineState.consume()))!
                _ = lineState.consume() // Consume '='
                setDigit(digit, definition: consumeRemaining(lineState))
            } else if lineState.peek() == "1" && lineState.input.count > lineState.index.utf16Offset(in: lineState.input) + 2 && 
                      lineState.input[lineState.input.index(lineState.index, offsetBy: 1)].isNumber && 
                      lineState.input[lineState.input.index(lineState.index, offsetBy: 1)] >= "0" && 
                      lineState.input[lineState.input.index(lineState.index, offsetBy: 1)] <= "5" && 
                      lineState.input[lineState.input.index(lineState.index, offsetBy: 2)] == "=" {
                // Digit definition 10-15
                _ = lineState.consume() // Consume '1'
                let digit = 10 + Int(String(lineState.consume()))!
                _ = lineState.consume() // Consume '='
                setDigit(digit, definition: consumeRemaining(lineState))
            } else if matchAndConsume(lineState, prefix: "ZERO=") {
                setDigit(0, definition: consumeRemaining(lineState))
            } else if matchAndConsume(lineState, prefix: "ONE=") {
                setDigit(1, definition: consumeRemaining(lineState))
            } else if matchAndConsume(lineState, prefix: "TWO=") {
                setDigit(2, definition: consumeRemaining(lineState))
            } else if matchAndConsume(lineState, prefix: "THREE=") {
                setDigit(3, definition: consumeRemaining(lineState))
            } else if matchAndConsume(lineState, prefix: "PREFIX=") {
                self.prefix = consumeRemaining(lineState)
            } else if matchAndConsume(lineState, prefix: "SUFFIX=") {
                self.suffix = consumeRemaining(lineState)
            } else if matchAndConsume(lineState, prefix: "R-PREFIX=") {
                self.rPrefix = consumeRemaining(lineState)
            } else if matchAndConsume(lineState, prefix: "R-SUFFIX=") {
                self.rSuffix = consumeRemaining(lineState)
            } else if matchAndConsume(lineState, prefix: "FIRSTBIT=MSB") {
                self.msb = true
            } else if matchAndConsume(lineState, prefix: "FIRSTBIT=LSB") {
                self.msb = false
            } else if matchAndConsume(lineState, prefix: "FORM=") {
                self.form = consumeRemaining(lineState)
            } else if matchAndConsume(lineState, prefix: "DEFINE") || matchAndConsume(lineState, prefix: "DEFAULT") {
                // Handle DEFINE syntax variations
                var varName: Character = " "
                
                if lineState.input.count > lineState.index.utf16Offset(in: lineState.input) + 1 && 
                   lineState.input[lineState.input.index(lineState.index, offsetBy: 1)] == "=" {
                    // define x = ...
                    varName = lineState.consume()
                    _ = lineState.consume() // Consume '='
                } else if lineState.peek() == "=" && lineState.input.count > lineState.index.utf16Offset(in: lineState.input) + 3 && 
                          lineState.input[lineState.input.index(lineState.index, offsetBy: 1)...lineState.input.index(lineState.index, offsetBy: 3)] == "AS" {
                    // define = x as ... (syntax error, but handling it)
                    _ = lineState.consume() // Consume '='
                    varName = lineState.consume()
                    _ = matchAndConsume(lineState, prefix: "AS") // Consume "AS"
                } else if lineState.input.count > lineState.index.utf16Offset(in: lineState.input) + 2 && 
                          lineState.input[lineState.input.index(lineState.index, offsetBy: 1)...lineState.input.index(lineState.index, offsetBy: 2)] == "AS" {
                    // define x as ...
                    varName = lineState.consume()
                    _ = matchAndConsume(lineState, prefix: "AS") // Consume "AS"
                }
                
                if varName >= "A" && varName <= "Z" {
                    def[Int(varName.asciiValue! - Character("A").asciiValue!)] = consumeRemaining(lineState)
                }
            } else if matchAndConsume(lineState, prefix: "DEVICE=") {
                parsePair(lineState, result: &self.device)
            } else if matchAndConsume(lineState, prefix: "FUNCTION=") {
                parsePair(lineState, result: &self.functions) // Parse first pair F.N
                if matchAndConsume(lineState, prefix: "..") {
                    // Parse second pair F.N 
                    var tempPair = [-1, -1]
                    parsePair(lineState, result: &tempPair)
                    self.functions[2] = tempPair[0]
                    self.functions[3] = tempPair[1]
                }
            }
            // Ignore unknown lines
        }
        
        // Post-processing checks and defaults
        if self.device[1] >= 0 {
            def[Int(Character("S").asciiValue! - Character("A").asciiValue!)] = nil // Clear definition if S has a range
        }
        if self.functions[1] >= 0 {
            def[Int(Character("N").asciiValue! - Character("A").asciiValue!)] = nil // Clear definition if N has a range
        }
        
        // Basic validation check
        let isValid = self.form != nil &&
                      self.digits[0] != nil &&
                      self.digits[1] != nil &&
                      self.functions[0] != -1
        
        return isValid
    }
    
    /**
     Generates the pulse sequence for given D, S, F values
     - Parameters:
        - d: Device code
        - s: Subdevice code
        - f: Function code
     - Returns: Array of pulse/gap durations in microseconds
     */
    func generate(_ d: Int, _ s: Int, _ f: Int) -> [Double] {
        // Validate prerequisite state
        guard let form = form, digits[0] != nil, digits[1] != nil else {
            print("Error: IRP not properly initialized. Missing form or basic digit definitions.")
            return [] // Return empty array on error
        }
        
        // Setup Generation Context
        value["D"] = d
        
        // Handle subdevice: s < 0 indicates no explicit subdevice provided
        if s >= 0 {
            value["S"] = s
        }
        
        value["F"] = f
        value["N"] = -1 // N is for function ranges, not used in single generation
        
        // Initialize state for generation
        hexSequence.removeAll()
        cumulativeTime = 0.0
        // pendingBits must be initialized after readIrpString might have changed msb/bitGroup
        pendingBits = msb ? 1 : bitGroup
        
        // Run Generation
        _ = genHexSequence(form)
        
        // Handle message time padding
        if messageTime > 0 && cumulativeTime < messageTime {
            genHexPulseGap(cumulativeTime - messageTime) // Add final gap
        }
        
        // Ensure even number of elements in the final sequence
        // Pulses must be paired with gaps
        if hexSequence.count % 2 != 0 {
            print("Warning: Final sequence has odd length. Appending dummy gap (-1.0).")
            genHexPulseGap(-1.0)
        }
        
        // Return a copy to prevent external modification
        return hexSequence
    }
    
    // MARK: - Private Helper Methods for Parsing and Generation
    
    /** Matches and consumes a prefix string if present */
    private func matchAndConsume(_ state: ParserState, prefix: String) -> Bool {
        if state.remaining().hasPrefix(prefix) {
            for _ in 0..<prefix.count {
                _ = state.consume()
            }
            return true
        }
        return false
    }
    
    /** Returns remaining string and advances parser state */
    private func consumeRemaining(_ state: ParserState) -> String {
        let result = state.remaining()
        while state.hasMore() {
            _ = state.consume()
        }
        return result
    }
    
    /** Sets a digit definition */
    private func setDigit(_ d: Int, definition: String) {
        if d >= 0 && d < 16 {
            digits[d] = definition
            while d >= bitGroup {
                bitGroup <<= 1
            }
        }
    }
    
    /** Parses "X.Y" or "X" into an int array */
    private func parsePair(_ state: ParserState, result: inout [Int]) {
        for i in 0..<2 {
            result[i] = -1
        }
        
        for nIndex in 0..<2 {
            var num = 0
            var numFound = false
            
            while state.hasMore() {
                let c = state.peek()
                if c.isNumber {
                    num = num * 10 + Int(String(c))!
                    numFound = true
                    _ = state.consume()
                } else {
                    break
                }
            }
            
            if numFound {
                result[nIndex] = num
            } else {
                // If no number was found for the first part, break
                if nIndex == 0 { break }
            }
            
            // Check for separator '.' only if we expect a second number
            if nIndex == 0 && state.hasMore() && state.peek() == "." {
                let nextCharIndex = state.input.index(state.index, offsetBy: 1, limitedBy: state.input.endIndex)
                let nextChar = nextCharIndex != nil && nextCharIndex! < state.input.endIndex ? state.input[nextCharIndex!] : " "
                
                if nextChar.isNumber {
                    _ = state.consume() // Consume the '.'
                } else {
                    // If '.' is not followed by a digit, stop parsing
                    break
                }
            } else {
                // If no '.' or already parsed second number, stop
                break
            }
        }
    }
    
    /** Parses a value expression (recursive descent parser) */
    private func parseVal(_ state: ParserState, precedence: OperatorPrecedence) -> Value {
        var result = Value()
        let startChar = state.peek()
        
        if startChar >= "A" && startChar <= "Z" {
            let varName = state.consume()
            let ndx = Int(varName.asciiValue! - Character("A").asciiValue!)
            
            if let definition = def[ndx], !definition.isEmpty {
                // Recursively parse the definition
                let defState = ParserState(input: definition)
                result = parseVal(defState, precedence: .base)
                if defState.hasMore() {
                    print("Warning: Unparsed characters in definition for '\(varName)': \(defState.remaining())")
                }
            } else {
                // Get value from the current context
                result.val = Double(value[varName, default: 0])
                result.bits = 0 // Simple value, not a bitfield initially
            }
        } else if startChar.isNumber {
            result.bits = 0
            result.val = 0.0
            
            // Simple number parsing (integer part)
            while state.hasMore() && state.peek().isNumber {
                result.val = result.val * 10 + Double(Int(String(state.consume()))!)
            }
        } else if startChar == "-" {
            _ = state.consume() // Consume '-'
            result = parseVal(state, precedence: .unary)
            result.val = -result.val
            if result.bits > 0 { // If it was a bitfield, it becomes a simple value
                result.bits = 0
            }
        } else if startChar == "~" {
            _ = state.consume() // Consume '~'
            result = parseVal(state, precedence: .unary)
            
            // Apply bitwise NOT
            let intVal = UInt64(result.val)
            if result.bits > 0 {
                let inverted = ~intVal
                result.val = Double(inverted & mask[result.bits]) // Apply mask
            } else {
                // Bitwise NOT on non-bitfield numbers is standard integer NOT
                result.val = Double(~intVal)
                result.bits = 0 // Result is not a bitfield
            }
        } else if startChar == "(" {
            _ = state.consume() // Consume '('
            result = parseVal(state, precedence: .base)
            if state.peek() == ")" {
                _ = state.consume() // Consume ')'
            } else {
                print("Error: Mismatched parentheses in expression near: \(state.remaining())")
                // Handle error: Mismatched parentheses
                result = Value() // Return default/error value
            }
        } else {
            print("Error: Unexpected character in expression: '\(startChar)' near: \(state.remaining())")
            // Handle error: Unexpected character
            result = Value() // Return default/error value
            if state.hasMore() { _ = state.consume() } // Consume the bad character to attempt recovery
        }
        
        // Check for time units immediately after a base value/expression
        if state.peek() == "M" {
            result.val *= 1000.0 // milliseconds to microseconds
            result.bits = -1     // Indicate time unit
            _ = state.consume()
        } else if state.peek() == "U" {
            // Value is already in microseconds
            result.bits = -1    // Indicate time unit
            _ = state.consume()
        }
        
        // Handle binary operators based on precedence
        while state.hasMore() {
            let op = state.peek()
            var nextPrecedence: OperatorPrecedence
            var v2: Value
            
            if op == "*" && precedence.rawValue < OperatorPrecedence.times.rawValue {
                nextPrecedence = .times
                _ = state.consume()
                v2 = parseVal(state, precedence: nextPrecedence)
                result.val *= v2.val
                if result.bits > 0 { result.bits = 0 } // Result is no longer a bitfield
            } else if op == "+" && precedence.rawValue < OperatorPrecedence.plus.rawValue {
                nextPrecedence = .plus
                _ = state.consume()
                v2 = parseVal(state, precedence: nextPrecedence)
                result.val += v2.val
                if result.bits > 0 { result.bits = 0 }
            } else if op == "-" && precedence.rawValue < OperatorPrecedence.plus.rawValue {
                nextPrecedence = .plus
                _ = state.consume()
                v2 = parseVal(state, precedence: nextPrecedence)
                result.val -= v2.val
                if result.bits > 0 { result.bits = 0 }
            } else if op == "^" && precedence.rawValue < OperatorPrecedence.plus.rawValue {
                nextPrecedence = .plus // Same precedence as +/- in original code
                _ = state.consume()
                v2 = parseVal(state, precedence: nextPrecedence)
                result.val = Double(UInt64(result.val) ^ UInt64(v2.val))
                
                // Bit length propagation (take max bits if one is defined)
                if result.bits > 0 && (v2.bits <= 0 || v2.bits > result.bits) {
                    result.bits = v2.bits
                }
                if result.bits <= 0 && v2.bits > 0 {
                    result.bits = v2.bits
                }
            } else if op == ":" && precedence.rawValue < OperatorPrecedence.colon.rawValue {
                nextPrecedence = .colon
                _ = state.consume() // Consume ':'
                v2 = parseVal(state, precedence: nextPrecedence) // Parse the bit count/field specifier
                result.bits = Int(v2.val)
                
                if state.peek() == ":" { // Check for optional shift part (value:bits:shift)
                    _ = state.consume() // Consume second ':'
                    v2 = parseVal(state, precedence: nextPrecedence) // Parse shift amount
                    result.val = Double(UInt64(result.val) >> UInt64(v2.val))
                }
                
                if result.bits < 0 { // Negative bits indicates reversal
                    result.bits = -result.bits
                    if result.bits > 0 && result.bits <= 32 {
                        result.val = Double(reverseBits(UInt64(result.val)) >> UInt64(32 - result.bits))
                    } else {
                        print("Warning: Invalid bit count for reversal: \(result.bits)")
                    }
                }
                
                // Apply mask
                if result.bits > 0 && result.bits < mask.count {
                    result.val = Double(UInt64(result.val) & mask[result.bits])
                } else if result.bits != 0 { // Allow bits=0 for simple values
                    print("Warning: Invalid bit count for mask: \(result.bits)")
                }
            } else {
                break // Operator has lower precedence or is not recognized here
            }
        }
        
        return result
    }
    
    /** Adds a pulse (+) or gap (-) to the sequence */
    private func genHexPulseGap(_ duration: Double) {
        if duration == 0.0 {
            return // Nothing to add
        }
        
        let nHex = hexSequence.count
        if duration > 0 { // Pulse
            cumulativeTime += duration
            if (nHex % 2) != 0 { // Last element was a pulse, add to it (shouldn't happen with valid IRP?)
                print("Warning: Adding pulse to existing pulse? Merging duration.")
                hexSequence[nHex - 1] += duration
            } else { // Last was a gap or list is empty, add new pulse
                hexSequence.append(duration)
            }
        } else { // Gap (duration is negative)
            let gapDuration = -duration
            cumulativeTime += gapDuration
            if (nHex % 2) != 0 { // Last element was a pulse, add new gap
                hexSequence.append(gapDuration)
            } else if nHex > 0 { // Last was a gap, add to it
                hexSequence[nHex - 1] += gapDuration
            } else {
                // Warning: Starting sequence with a gap?
                print("Warning: Sequence starts with a gap.")
                // In the original code, it appears to do nothing if the sequence starts with a gap
            }
        }
    }
    
    /** Generates sequence from a definition string (like form, prefix, digits) */
    private func genHexSequence(_ pattern: String) -> Int {
        // Based on C++ IRP::genHex(char* Pattern)
        guard !pattern.isEmpty else {
            print("Warning: Attempting to generate sequence from empty pattern.")
            return -1 // Indicate error or no sequence generated
        }
        
        var singleSequenceLength = -1 // Length of the sequence before the first ';' (-1 if no ';')
        let state = ParserState(input: pattern)
        
        // Check for empty single sequence
        if state.peek() == ";" {
            singleSequenceLength = 0
            _ = state.consume() // Consume ';'
        }
        
        while state.hasMore() {
            let startChar = state.peek()
            
            if startChar == "*" {
                _ = state.consume() // Consume '*'
                let prefixToUse = (singleSequenceLength >= 0 && rPrefix != nil) ? rPrefix : prefix
                if let prefixToUse = prefixToUse {
                    _ = genHexSequence(prefixToUse) // Recursive call
                }
            } else if startChar == "_" {
                _ = state.consume() // Consume '_'
                let suffixToUse = (singleSequenceLength >= 0 && rSuffix != nil) ? rSuffix : suffix
                if let suffixToUse = suffixToUse {
                    _ = genHexSequence(suffixToUse) // Recursive call
                }
                // Apply message time padding after suffix (if needed)
                if messageTime > 0 && cumulativeTime < messageTime {
                    genHexPulseGap(cumulativeTime - messageTime) // Add gap to reach messageTime
                }
            } else if startChar == "^" {
                _ = state.consume() // Consume '^'
                let val = parseVal(state, precedence: .base)
                if val.bits == 0 && timeBase != 0 { // Unitless value, scale by timeBase
                    // Add padding gap if current time is less than specified time
                    if messageTime > 0 && cumulativeTime < val.val * timeBase {
                        genHexPulseGap(cumulativeTime - val.val * timeBase) // Add gap
                    }
                } else if messageTime > 0 && cumulativeTime < val.val {
                    genHexPulseGap(cumulativeTime - val.val) // Add gap
                }
            } else {
                // Default: Parse a value or bitfield
                let val = parseVal(state, precedence: .base)
                
                if val.bits <= 0 { // Direct duration or time value
                    if val.bits == 0 && timeBase != 0 { // Unitless constant, scale by timeBase
                        genHexPulseGap(val.val * timeBase)
                    } else {
                        // Add the pulse/gap (positive value means pulse)
                        genHexPulseGap(val.val)
                    }
                } else { // Bit sequence (val.bits > 0)
                    var number = UInt64(val.val)
                    var bitsToProcess = val.bits
                    
                    // Apply MSB reversal if needed
                    if msb && bitsToProcess <= 32 {
                        number = reverseBits(number) >> UInt64(32 - bitsToProcess)
                    }
                    
                    while bitsToProcess > 0 {
                        bitsToProcess -= 1
                        let currentBit = Int(number & 1)
                        
                        if msb {
                            // Shift new bit in from the right (LSB position)
                            pendingBits = (pendingBits << 1) | currentBit
                            // Check if a full group is formed (mask is power_of_2 - 1)
                            if (pendingBits & bitGroup) != 0 { // Check the marker bit (leftmost bit of the group)
                                let digitIndex = pendingBits & (bitGroup - 1) // Extract the value bits
                                if digitIndex < digits.count, let digitDef = digits[digitIndex] {
                                    _ = genHexSequence(digitDef) // Recursive call
                                } else {
                                    print("Warning: Undefined digit definition for index: \(digitIndex) (msb)")
                                }
                                pendingBits = 1 // Reset for next group (marker bit)
                            }
                        } else { // LSB
                            // Shift new bit in from the left (MSB position of the group)
                            pendingBits = (pendingBits >> 1) | (currentBit * bitGroup)
                            // Check if a full group is formed (marker bit is the LSB)
                            if (pendingBits & 1) != 0 { // Check the marker bit
                                let digitIndex = pendingBits >> 1 // Extract the value bits
                                if digitIndex < digits.count, let digitDef = digits[digitIndex] {
                                    _ = genHexSequence(digitDef) // Recursive call
                                } else {
                                    print("Warning: Undefined digit definition for index: \(digitIndex) (lsb)")
                                }
                                pendingBits = bitGroup // Reset for next group (marker bit)
                            }
                        }
                        number >>= 1 // Shift number to get next bit
                    }
                }
            }
            
            // Check for separators after processing an element
            if state.hasMore() {
                let separator = state.peek()
                if separator == ";" {
                    _ = state.consume() // Consume ';'
                    // End of single sequence detected
                    if messageTime > 0 && cumulativeTime < messageTime {
                        genHexPulseGap(cumulativeTime - messageTime) // Pad before marking end
                    }
                    if (hexSequence.count % 2) != 0 {
                        genHexPulseGap(-1.0) // Ensure even length (add dummy gap)
                        print("Warning: Odd number of elements before ';', adding dummy gap (-1.0).")
                    }
                    singleSequenceLength = hexSequence.count
                    cumulativeTime = 0.0 // Reset time for repeat sequence
                } else if separator == "," {
                    _ = state.consume() // Consume ',' - continue sequence
                } else {
                    // Unexpected character, assume end of pattern for this sequence
                    break
                }
            } else {
                // End of pattern string
                break
            }
        }
        
        return singleSequenceLength
    }
    
    /** Generates sequence from a list of durations */
    private func genHexSequence(_ sequence: [Double]) {
        var nIndex = 0
        while nIndex < sequence.count {
            // Add pulse
            genHexPulseGap(sequence[nIndex])
            nIndex += 1
            
            if nIndex >= sequence.count {
                break
            }
            
            // Add gap (represented as negative for genHexPulseGap)
            genHexPulseGap(-sequence[nIndex])
            nIndex += 1
        }
    }
} 