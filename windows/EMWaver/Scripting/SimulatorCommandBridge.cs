using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace EMWaver.Scripting;

internal sealed class SimulatorCommandBridge
{
    private const byte StatusOk = 0x80;
    private const byte StatusError = 0x81;

    private readonly SimulatorFixture _fixture;
    private readonly HashSet<byte> _pins;
    private readonly HashSet<byte> _pwmPins;
    private readonly Dictionary<byte, byte> _gpioLevels;
    private readonly Dictionary<byte, string> _gpioModes;
    private readonly object _lock = new();

    private SimulatorCommandBridge(SimulatorFixture fixture)
    {
        _fixture = fixture;
        _pins = fixture.Gpio.Pins.Select(pin => pin.Number).ToHashSet();
        _pwmPins = fixture.Pwm.Pins.ToHashSet();
        _gpioLevels = fixture.Gpio.Pins.ToDictionary(pin => pin.Number, pin => (byte)Math.Min(pin.InitialLevel, (byte)1));
        _gpioModes = fixture.Gpio.Pins.ToDictionary(pin => pin.Number, _ => "input");
    }

    internal static SimulatorCommandBridge FromFixtureJson(string source)
    {
        var fixture = JsonSerializer.Deserialize<SimulatorFixture>(source, JsonOptions)
            ?? throw new InvalidOperationException("Invalid EMWaver simulator fixture.");
        if (string.IsNullOrWhiteSpace(fixture.Board.Type))
        {
            throw new InvalidOperationException("Invalid EMWaver simulator fixture: missing board type.");
        }
        return new SimulatorCommandBridge(fixture);
    }

    internal static SimulatorCommandBridge FromFixtureFile(string path)
    {
        return FromFixtureJson(File.ReadAllText(path));
    }

    internal byte[] SendPacket(byte[] command, int timeoutMs)
    {
        try
        {
            return Handle(command ?? Array.Empty<byte>());
        }
        catch
        {
            return new[] { StatusError };
        }
    }

    private byte[] Handle(byte[] command)
    {
        if (command.Length == 0) throw new InvalidOperationException("simulator_empty_command");

        return command[0] switch
        {
            0x01 => new[] { StatusOk, _fixture.Board.FirmwareVersion.Major, _fixture.Board.FirmwareVersion.Minor, _fixture.Board.FirmwareVersion.Patch },
            0x02 => Ok(),
            0x04 => OkText(_fixture.Board.Name),
            0x09 => OkText(_fixture.Board.Type),
            0x10 => HandleGpio(command),
            0x20 => HandleAdc(command),
            0x30 => HandleUart(command),
            0x40 => HandleI2c(command),
            0x50 => HandleSpi(command),
            0x70 => HandlePwm(command),
            _ => throw new InvalidOperationException($"simulator_unsupported_opcode_0x{command[0]:X2}"),
        };
    }

    private byte[] HandleGpio(byte[] command)
    {
        var subcommand = ByteAt(command, 1, "gpio subcommand missing");
        var pin = ByteAt(command, 2, "gpio pin missing");
        RequirePin(pin);

        lock (_lock)
        {
            switch (subcommand)
            {
                case 0x00:
                    _gpioModes[pin] = "input";
                    return Ok();
                case 0x01:
                    _gpioModes[pin] = "output";
                    return Ok();
                case 0x02:
                    return new[] { StatusOk, _gpioLevels.GetValueOrDefault(pin, (byte)0) };
                case 0x03:
                    _gpioLevels[pin] = 1;
                    return Ok();
                case 0x04:
                    _gpioLevels[pin] = 0;
                    return Ok();
                case 0x05:
                case 0x06:
                    return Ok();
                default:
                    throw new InvalidOperationException($"simulator_unsupported_gpio_subcommand_0x{subcommand:X2}");
            }
        }
    }

    private byte[] HandleAdc(byte[] command)
    {
        var source = ByteAt(command, 1, "adc source missing");
        var pin = command.Length > 2 ? command[2] : (byte)0;
        ushort value = source switch
        {
            0x00 => PinAdcValue(pin),
            0x01 => _fixture.Adc.InternalSources.GetValueOrDefault("temp", (ushort)0),
            0x02 => _fixture.Adc.InternalSources.GetValueOrDefault("vrefint", (ushort)0),
            0x03 => _fixture.Adc.InternalSources.GetValueOrDefault("vbat", (ushort)0),
            _ => throw new InvalidOperationException($"simulator_unsupported_adc_source_0x{source:X2}"),
        };

        return new[] { StatusOk, (byte)(value & 0xff), (byte)((value >> 8) & 0xff) };
    }

    private byte[] HandleUart(byte[] command)
    {
        var subcommand = ByteAt(command, 1, "uart subcommand missing");
        switch (subcommand)
        {
            case 0x00:
            case 0x01:
                return Ok();
            case 0x02:
                return new[] { StatusOk, command.Length > 8 ? command[8] : (byte)0 };
            case 0x03:
                var length = Math.Min(command.Length > 8 ? command[8] : 0, 63);
                var bytes = _fixture.Serial.ReadBytes.Take(length).ToArray();
                return new[] { StatusOk, (byte)bytes.Length }.Concat(bytes).ToArray();
            default:
                throw new InvalidOperationException($"simulator_unsupported_uart_subcommand_0x{subcommand:X2}");
        }
    }

    private byte[] HandleI2c(byte[] command)
    {
        var subcommand = ByteAt(command, 1, "i2c subcommand missing");
        switch (subcommand)
        {
            case 0x00:
            case 0x01:
            case 0x02:
                return Ok();
            case 0x03:
            case 0x04:
                var address = command.Length > 8 ? (byte)(command[8] & 0x7f) : (byte)0;
                var lengthIndex = subcommand == 0x03 ? 9 : 10;
                var length = Math.Min(command.Length > lengthIndex ? command[lengthIndex] : 0, 63);
                var configured = _fixture.I2c.Addresses.GetValueOrDefault(address.ToString())?.ReadBytes ?? Array.Empty<byte>();
                return new[] { StatusOk }
                    .Concat(RepeatedReply(configured, _fixture.I2c.DefaultReadByte, length))
                    .ToArray();
            default:
                throw new InvalidOperationException($"simulator_unsupported_i2c_subcommand_0x{subcommand:X2}");
        }
    }

    private byte[] HandleSpi(byte[] command)
    {
        var rxLength = Math.Min(command.Length > 2 ? command[2] : 0, 62);
        var txLength = Math.Min(command.Length > 3 ? command[3] : 0, Math.Max(0, command.Length - 4));
        var tx = txLength > 0 ? command.Skip(4).Take(txLength).ToArray() : Array.Empty<byte>();
        var wanted = rxLength > 0 ? rxLength : txLength;
        var key = HexKey(tx);
        var configured = _fixture.Spi.Transfers.GetValueOrDefault(key) ?? Array.Empty<byte>();

        if (configured.Length == 0 && rxLength == 0)
        {
            return new[] { StatusOk }.Concat(tx).ToArray();
        }
        return new[] { StatusOk }
            .Concat(RepeatedReply(configured, _fixture.Spi.DefaultReadByte, wanted))
            .ToArray();
    }

    private byte[] HandlePwm(byte[] command)
    {
        var subcommand = ByteAt(command, 1, "pwm subcommand missing");
        var pin = ByteAt(command, 2, "pwm pin missing");
        RequirePin(pin);
        if (!_pwmPins.Contains(pin))
        {
            throw new InvalidOperationException($"simulator_pin_{pin}_does_not_support_pwm");
        }
        return subcommand switch
        {
            0x00 or 0x01 or 0x02 => Ok(),
            _ => throw new InvalidOperationException($"simulator_unsupported_pwm_subcommand_0x{subcommand:X2}"),
        };
    }

    private ushort PinAdcValue(byte pin)
    {
        RequirePin(pin);
        return _fixture.Adc.PinValues.GetValueOrDefault(pin.ToString(), (ushort)0);
    }

    private void RequirePin(byte pin)
    {
        if (!_pins.Contains(pin))
        {
            throw new InvalidOperationException($"simulator_unknown_pin_{pin}");
        }
    }

    private static byte ByteAt(byte[] command, int index, string message)
    {
        if (command.Length <= index) throw new InvalidOperationException(message);
        return command[index];
    }

    private static byte[] Ok() => new[] { StatusOk };

    private static byte[] OkText(string text) => new[] { StatusOk }.Concat(Encoding.UTF8.GetBytes(text ?? "")).ToArray();

    private static IEnumerable<byte> RepeatedReply(byte[] configured, byte fill, int count)
    {
        for (var i = 0; i < count; i += 1)
        {
            yield return i < configured.Length ? configured[i] : fill;
        }
    }

    private static string HexKey(IEnumerable<byte> bytes)
    {
        return string.Concat(bytes.Select(value => value.ToString("X2")));
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new SimulatorByteArrayJsonConverter() },
    };

    private sealed class SimulatorByteArrayJsonConverter : JsonConverter<byte[]>
    {
        public override byte[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.String)
            {
                return reader.GetBytesFromBase64();
            }

            if (reader.TokenType != JsonTokenType.StartArray)
            {
                throw new JsonException("Expected byte array.");
            }

            var bytes = new List<byte>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray)
                {
                    return bytes.ToArray();
                }
                if (reader.TokenType != JsonTokenType.Number || !reader.TryGetByte(out var value))
                {
                    throw new JsonException("Expected byte value.");
                }
                bytes.Add(value);
            }

            throw new JsonException("Unterminated byte array.");
        }

        public override void Write(Utf8JsonWriter writer, byte[] value, JsonSerializerOptions options)
        {
            writer.WriteStartArray();
            foreach (var b in value)
            {
                writer.WriteNumberValue(b);
            }
            writer.WriteEndArray();
        }
    }

    private sealed record SimulatorFixture(
        [property: JsonPropertyName("board")] SimulatorBoardFixture Board,
        [property: JsonPropertyName("gpio")] SimulatorGpioFixture Gpio,
        [property: JsonPropertyName("adc")] SimulatorAdcFixture Adc,
        [property: JsonPropertyName("pwm")] SimulatorPwmFixture Pwm,
        [property: JsonPropertyName("serial")] SimulatorSerialFixture Serial,
        [property: JsonPropertyName("i2c")] SimulatorI2cFixture I2c,
        [property: JsonPropertyName("spi")] SimulatorSpiFixture Spi
    );

    private sealed record SimulatorBoardFixture(
        [property: JsonPropertyName("type")] string Type,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("firmwareVersion")] SimulatorFirmwareVersion FirmwareVersion,
        [property: JsonPropertyName("hardwareUid")] string HardwareUid,
        [property: JsonPropertyName("protocolVersion")] byte ProtocolVersion
    );

    private sealed record SimulatorFirmwareVersion(
        [property: JsonPropertyName("major")] byte Major,
        [property: JsonPropertyName("minor")] byte Minor,
        [property: JsonPropertyName("patch")] byte Patch
    );

    private sealed record SimulatorGpioFixture(
        [property: JsonPropertyName("pins")] List<SimulatorGpioPinFixture> Pins
    );

    private sealed record SimulatorGpioPinFixture(
        [property: JsonPropertyName("number")] byte Number,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("modes")] List<string> Modes,
        [property: JsonPropertyName("initialLevel")] byte InitialLevel
    );

    private sealed record SimulatorAdcFixture(
        [property: JsonPropertyName("pinValues")] Dictionary<string, ushort> PinValues,
        [property: JsonPropertyName("internalSources")] Dictionary<string, ushort> InternalSources
    );

    private sealed record SimulatorPwmFixture(
        [property: JsonPropertyName("defaultFrequencyHz")] uint DefaultFrequencyHz,
        [property: JsonPropertyName("pins")] List<byte> Pins
    );

    private sealed record SimulatorSerialFixture(
        [property: JsonPropertyName("readBytes")] byte[] ReadBytes
    );

    private sealed record SimulatorI2cFixture(
        [property: JsonPropertyName("defaultReadByte")] byte DefaultReadByte,
        [property: JsonPropertyName("addresses")] Dictionary<string, SimulatorI2cAddressFixture> Addresses
    );

    private sealed record SimulatorI2cAddressFixture(
        [property: JsonPropertyName("readBytes")] byte[] ReadBytes
    );

    private sealed record SimulatorSpiFixture(
        [property: JsonPropertyName("defaultReadByte")] byte DefaultReadByte,
        [property: JsonPropertyName("transfers")] Dictionary<string, byte[]> Transfers
    );
}
