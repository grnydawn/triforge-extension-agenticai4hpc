// src/services/tritonConfig.ts
// Pure renderer for TRITON's triton_execution.cfg. Extracted from
// ExecutionSetupEditor._writeTritonConfig so the run path and the project
// import share ONE generator. Behavior is pinned by a characterization test
// (test/unit/services/tritonConfig.test.ts) — change it only deliberately.

/** Loosely-typed project source: a TriforgeProject (or the editor's message-
 *  merged variant). Some template keys (const_mann, hextra, n_infile, …) have
 *  no TriforgeProject field yet and fall back to the template default. */
export type TritonConfigSource = Record<string, any>;

export function renderTritonExecutionCfg(
  project: TritonConfigSource,
  templateContent: string,
): string {
  const lines: string[] = [];

  // Map project properties to config keys
  const valueMap: { [key: string]: any } = {
    'checkpoint_id': project.checkpoint_id,
    'const_mann': project.const_mann,
    'courant': project.courant,
    'dem_filename': project.demPath,
    'domain_decomposition': project.domain_decomposition,
    'factor_interval_domain_decomposition': project.factor_interval_domain_decomposition,
    'gpu_direct_flag': project.gpu_direct_flag,
    'h_infile': project.initialInputPath,
    'hextra': project.hextra,
    'hydrograph_filename': project.hydrograph_filename,
    'input_format': project.input_format,
    'it_count': project.it_count,
    'it_print': project.it_print,
    'n_infile': project.n_infile,
    'num_extbc': project.num_extbc,
    'num_runoffs': project.num_runoffs,
    'num_sources': project.num_sources,
    'observation_loc_file': project.observation_loc_file,
    'open_boundaries': project.open_boundaries,
    'outfile_pattern': project.outfile_pattern,
    'output_format': project.output_format,
    'output_option': project.output_option,
    'print_interval': project.print_interval,
    'print_observation': project.print_observation,
    'print_option': project.print_option,
    'projection': project.projection,
    'qx_infile': project.qx_infile,
    'qy_infile': project.qy_infile,
    'runoff_filename': project.runoff_filename,
    'runoff_map': project.runoff_map,
    'sim_duration': project.sim_duration,
    'sim_start_time': project.sim_start_time,
    'src_loc_file': project.src_loc_file,
    'time_increment_fixed': project.time_increment_fixed,
    'time_series_flag': project.time_series_flag,
    'time_step': project.time_step
  };

  const templateLines = templateContent.split(/\r?\n/);

  for (const line of templateLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      lines.push(line);
      continue;
    }

    const parts = trimmed.split('=');
    if (parts.length >= 1) {
      const key = parts[0].trim();
      const defaultVal = parts.slice(1).join('=').trim();

      const val = valueMap[key];

      // Resolve the final value: prefer the project value, otherwise
      // fall back to the template default.
      const resolvedVal = (val !== undefined && val !== null && val !== '')
        ? `${val}`
        : defaultVal;

      // Discard any entry that has no value after the '=' sign
      // (e.g. "const_mann="). These lines are omitted entirely.
      if (resolvedVal === '') {
        continue;
      }

      lines.push(`${key}=${resolvedVal}`);
    } else {
      lines.push(line);
    }
  }

  return lines.join('\n');
}
