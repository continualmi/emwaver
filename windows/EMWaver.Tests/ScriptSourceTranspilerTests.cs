using EMWaver.Scripting;
using Xunit;

namespace EMWaver.Tests;

public sealed class ScriptSourceTranspilerTests
{
    [Fact]
    public void TranspilesNamedImportsAndAliases()
    {
        var source = "import { JSX, render as renderTree } from \"emw-jsx\";\nrenderTree(JSX.h(App, null));";

        var output = ScriptSourceTranspiler.Transpile(source);

        Assert.Contains("var __emw_mod_0 = require(\"emw-jsx\");", output);
        Assert.Contains("var JSX = __emw_mod_0.JSX;", output);
        Assert.Contains("var renderTree = __emw_mod_0.render;", output);
        Assert.DoesNotContain("import ", output);
    }

    [Fact]
    public void TranspilesNestedJsxElementsAndText()
    {
        var source = "render(<Column padding={16}><Text>Hello</Text><Button onTap={increment}>Increment</Button></Column>);";

        var output = ScriptSourceTranspiler.Transpile(source);

        Assert.Contains("JSX.h(Column, { padding: 16 }", output);
        Assert.Contains("JSX.h(Text, null, \"Hello\")", output);
        Assert.Contains("JSX.h(Button, { onTap: increment }, \"Increment\")", output);
        Assert.DoesNotContain("<Column", output);
    }

    [Fact]
    public void LeavesStringsAndComparisonsAlone()
    {
        var source = "var text = \"<Column>\";\nif (count < 3) { render(<Text>{text}</Text>); }";

        var output = ScriptSourceTranspiler.Transpile(source);

        Assert.Contains("var text = \"<Column>\";", output);
        Assert.Contains("count < 3", output);
        Assert.Contains("JSX.h(Text, null, text)", output);
    }
}
