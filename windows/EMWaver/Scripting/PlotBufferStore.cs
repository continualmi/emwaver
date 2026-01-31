using System;
using System.Collections.Generic;

namespace EMWaver.Scripting;

public sealed class PlotBufferStore
{
    public static PlotBufferStore Shared { get; } = new();

    public delegate byte[] Provider();

    private readonly object _lock = new();
    private readonly Dictionary<string, byte[]> _buffers = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Provider> _providers = new(StringComparer.Ordinal);

    private PlotBufferStore() { }

    public void SetBuffer(string id, byte[] data)
    {
        lock (_lock)
        {
            _buffers[id] = data;
        }
    }

    public void SetProvider(string id, Provider provider)
    {
        lock (_lock)
        {
            _providers[id] = provider;
        }
    }

    public byte[] GetBytes(string id)
    {
        Provider? provider;
        byte[]? stored;
        lock (_lock)
        {
            _providers.TryGetValue(id, out provider);
            _buffers.TryGetValue(id, out stored);
        }

        if (provider != null)
        {
            try { return provider(); }
            catch { return Array.Empty<byte>(); }
        }

        return stored ?? Array.Empty<byte>();
    }
}
