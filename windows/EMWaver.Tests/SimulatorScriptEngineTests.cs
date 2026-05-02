using System.Collections.Concurrent;
using EMWaver.Scripting;
using Xunit;

namespace EMWaver.Tests;

public sealed class SimulatorScriptEngineTests
{
    [Fact]
    public void ScriptEngineRunsHardwareScriptAgainstSharedSimulatorFixture()
    {
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "simulator", "fixtures", "basic-board.json");
        var simulator = SimulatorCommandBridge.FromFixtureFile(fixturePath);
        using var engine = new ScriptEngine();

        using var rendered = new ManualResetEventSlim(false);
        var errors = new ConcurrentQueue<string>();
        ScriptTree? tree = null;

        engine.Setup(
            renderHandler: next =>
            {
                tree = next;
                rendered.Set();
            },
            sendPacket: simulator.SendPacket,
            errorHandler: errors.Enqueue);

        engine.Execute("""
            pinMode(13, OUTPUT);
            digitalWrite(13, HIGH);
            var board = device.boardType({ refresh: true });
            var value = analogRead(0);
            UI.render(UI.column({
              children: [
                UI.text({ text: board }),
                UI.text({ text: String(value) })
              ]
            }));
            """);

        Assert.True(rendered.Wait(TimeSpan.FromSeconds(8)), "Timed out waiting for simulator-backed script render.");
        Assert.Empty(errors);
        Assert.NotNull(tree);
        Assert.Equal(ScriptNodeType.Column, tree!.Root.Type);
        Assert.Contains(tree.Root.Children, child => Text(child) == "emwaver-sim");
        Assert.Contains(tree.Root.Children, child => Text(child) == "2048");
    }

    private static string? Text(ScriptNode node)
    {
        return node.Props.Raw.TryGetValue("text", out var value) ? Convert.ToString(value) : null;
    }
}
