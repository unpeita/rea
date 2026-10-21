import ghidra.app.script.GhidraScript;
import ghidra.app.util.demangler.DemangledFunction;
import ghidra.app.util.demangler.DemangledObject;
import ghidra.app.util.demangler.DemanglerUtil;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Parameter;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;

/** Import-time correction: ARM CE static C++ members have no implicit object argument. */
public final class ReaGhidraWindowsCe extends GhidraScript {
  public void run() throws Exception {
    if (!currentProgram.getLanguage().getProcessor().toString().equals("ARM")
        || currentProgram.getDefaultPointerSize() != 4)
      throw new IllegalStateException("REA CE correction requires 32-bit ARM");
    int corrected = 0;
    for (Function function : currentProgram.getFunctionManager().getFunctions(true)) {
      monitor.checkCancelled();
      if (function.isThunk() || function.hasCustomVariableStorage()
          || function.getSignatureSource() == SourceType.USER_DEFINED
          || !"__thiscall".equals(function.getCallingConventionName())) continue;
      Parameter[] parameters = function.getParameters();
      if (parameters.length == 0 || !parameters[0].isAutoParameter()
          || !"this".equals(parameters[0].getName())) continue;
      boolean provenStatic = false;
      boolean conflicting = false;
      for (Symbol symbol : currentProgram.getSymbolTable().getSymbols(function.getEntryPoint())) {
        String name = symbol.getName();
        if (!name.startsWith("?")) continue;
        for (DemangledObject object :
            DemanglerUtil.demangle(currentProgram, name, function.getEntryPoint())) {
          if (!(object instanceof DemangledFunction signature)) continue;
          if (!signature.isStatic() || signature.getParameters().size() != parameters.length - 1)
            conflicting = true;
          else provenStatic = true;
        }
      }
      if (!provenStatic || conflicting) continue;
      // Recompute dynamic storage from the ARM compiler specification; preserve all formal types.
      function.setCallingConvention(
          currentProgram.getCompilerSpec().getDefaultCallingConvention().getName());
      if (function.getParameterCount() != parameters.length - 1
          || function.getAutoParameterCount() != 0)
        throw new IllegalStateException("CE static member correction failed: " + function.getEntryPoint());
      corrected++;
    }
    currentProgram.getOptions("Program Information").setString(
        "REA Windows CE static members", "decorated-static-no-this-v1; corrected=" + corrected);
    println("REA Windows CE static members corrected: " + corrected);
  }
}
