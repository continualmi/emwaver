using EMWaver.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using Windows.Devices.Enumeration;

namespace EMWaver.Services;

internal static class WindowsUsbMidiTransport
{
    internal static readonly string[] ContainerProperties = ["System.Devices.ContainerId"];

    internal static string SessionId(DevicePort port) => port.InDeviceId;

    internal static IReadOnlyList<DevicePort> PairPorts(
        IReadOnlyList<DeviceInformation> inDevices,
        IReadOnlyList<DeviceInformation> outDevices)
    {
        var outByContainerId = outDevices
            .Select(d => new { Dev = d, Cid = ContainerIdOf(d) })
            .Where(x => !string.IsNullOrWhiteSpace(x.Cid))
            .GroupBy(x => x.Cid!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Dev, StringComparer.OrdinalIgnoreCase);

        return inDevices
            .Select(i =>
            {
                var cid = ContainerIdOf(i);
                if (!string.IsNullOrWhiteSpace(cid) && outByContainerId.TryGetValue(cid!, out var o))
                {
                    return new { In = i, Out = o };
                }

                var byName = outDevices.FirstOrDefault(o => o.Name == i.Name);
                if (byName != null)
                {
                    return new { In = i, Out = byName };
                }

                var byContains = outDevices.FirstOrDefault(o =>
                    o.Name.Contains(i.Name, StringComparison.OrdinalIgnoreCase) ||
                    i.Name.Contains(o.Name, StringComparison.OrdinalIgnoreCase));

                return byContains == null ? null : new { In = i, Out = byContains };
            })
            .Where(p => p != null)
            .Select(p => new DevicePort(
                DisplayName: p!.In.Name,
                InDeviceId: p.In.Id,
                OutDeviceId: p.Out.Id
            ))
            .OrderBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    internal static DevicePort? ChoosePreferred(IReadOnlyList<DevicePort> ports)
    {
        return ports.FirstOrDefault(p => p.DisplayName.Contains("emwaver", StringComparison.OrdinalIgnoreCase)) ??
               ports.FirstOrDefault(p => !p.DisplayName.Contains("network", StringComparison.OrdinalIgnoreCase)) ??
               ports.FirstOrDefault();
    }

    private static string? ContainerIdOf(DeviceInformation device)
    {
        if (device.Properties == null) return null;
        if (!device.Properties.TryGetValue("System.Devices.ContainerId", out var value)) return null;
        return value?.ToString();
    }
}
