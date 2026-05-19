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
        using var completed = new ManualResetEventSlim(false);
        var errors = new ConcurrentQueue<string>();
        ScriptTree? tree = null;

        engine.Setup(
            renderHandler: next =>
            {
                tree = next;
                rendered.Set();
                completed.Set();
            },
            sendPacket: simulator.SendPacket,
            errorHandler: error =>
            {
                errors.Enqueue(error);
                completed.Set();
            });

        engine.Execute("""
            import { JSX, render } from "emw-jsx";
            import { Column, Text } from "emw-ui";
            import { gpio } from "emw-gpio";
            import { adc } from "emw-adc";

            gpio.mode(13, "output");
            gpio.write(13, 1);
            var board = device.boardType({ refresh: true });
            var value = adc.read(0);
            render(
              <Column>
                <Text>{board}</Text>
                <Text>{String(value)}</Text>
              </Column>
            );
            """);

        Assert.True(completed.Wait(TimeSpan.FromSeconds(8)), "Timed out waiting for simulator-backed script render.");
        Assert.Empty(errors);
        Assert.True(rendered.IsSet, "Script completed without rendering.");
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
