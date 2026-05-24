using System.Runtime.Versioning;
using System.Runtime.CompilerServices;

// This project is a WPF Windows desktop app.
// Mark the entire assembly as Windows-only so platform analyzers don't treat call sites as cross-platform.
[assembly: SupportedOSPlatform("windows10.0.17763.0")]
[assembly: InternalsVisibleTo("EMWaver.Tests")]
