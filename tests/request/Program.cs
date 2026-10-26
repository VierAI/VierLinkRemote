using System; using System.Linq;
using System.Text.Json; using VierLinkRemote.Shared;
int fail = 0;
void Ok(string j, string want) { try { var r = CaptureRequest.Parse(JsonDocument.Parse(j).RootElement); var got = r.Id + "|" + string.Join(",", r.Sections) + "|" + (r.Players == null ? "-" : string.Join(",", r.Players)); if (got != want) { fail++; Console.WriteLine("WRONG " + j + " " + got); } } catch (Exception e) { fail++; Console.WriteLine("THREW " + j + " " + e.Message); } }
void Bad(string j) { try { CaptureRequest.Parse(JsonDocument.Parse(j).RootElement); fail++; Console.WriteLine("ACCEPTED " + j); } catch (FormatException) { } }
Ok("{\"id\":\"a1\"}", "a1|sync,penumbra,glamourer,customizePlus,distance|-");
Ok("{\"id\":\"q\",\"players\":[\"P12\",\"receiver\"],\"sections\":[\"sync\"]}", "q|sync|P12,receiver");
foreach (var b in new[] { "[]", "\"x\"", "{}", "{\"id\":\"\"}", "{\"id\":\"a b\"}", "{\"id\":\"a\",\"reveal\":true}", "{\"id\":\"a\",\"id\":\"b\"}", "{\"id\":\"a\",\"players\":[\"Firstname Lastname\"]}", "{\"id\":\"a\",\"players\":[\"P1\",\"P1\"]}", "{\"id\":\"a\",\"sections\":[]}", "{\"id\":\"a\",\"sections\":[\"chat\"]}", "{\"id\":\"a\",\"sections\":\"sync\"}", "{\"id\":1}", "{\"id\":\"a\",\"players\":[" + string.Join(",", Enumerable.Range(0, 21).Select(i => "\"P" + i + "\"")) + "]}", "{\"id\":\"" + new string('x', 33) + "\"}" }) Bad(b);
Console.WriteLine(fail == 0 ? "C# request tests: 17/17 pass" : $"C# request tests: {fail} failed"); return fail;

