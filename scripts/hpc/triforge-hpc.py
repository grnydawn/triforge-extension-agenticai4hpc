#!/usr/bin/env python3
"""triforge-hpc: use a Triforge .tfp project on an HPC system without VS Code.

Two verbs:
    unpack PROJECT.tfp [--dest DIR]   lay out the project + a run-ready triton_execution.cfg
    pack   DIR [-o PROJECT.tfp]       repack outputs into a re-importable .tfp

Pure Python 3 standard library. No third-party dependencies.
"""
import argparse
import configparser
import glob
import json
import os
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone

SCHEMA_VERSION = "1.0.0"
MANIFEST_ENTRY = "triforge.export.json"
CONFIG_ENTRY = "config.json"

# Embedded copy of resources/triton_execution.cfg.template so the tool is a single
# portable file. test_embedded_template_matches_repo_source asserts they are equal.
CFG_TEMPLATE = """checkpoint_id=0
const_mann=
courant=0.5
dem_filename=
domain_decomposition=static
extbc_dir=
extbc_file=
factor_interval_domain_decomposition=1
gpu_direct_flag=0
h_infile=
hextra=0.001
hydrograph_filename=
input_format=BIN
it_count=0
it_print=3600
n_infile=
num_extbc=0
num_runoffs=0
num_sources=0
observation_loc_file=
open_boundaries=1
outfile_pattern=%s/%s/%s_%02d_%02d
output_format=ASC
output_option=PAR
print_interval=900
print_observation=1
print_option=huv
projection=EPSG:32616
qx_infile=
qy_infile=
runoff_filename=
runoff_map=
sim_duration=86400
sim_start_time=0
src_loc_file=
time_increment_fixed=0
time_series_flag=0
time_step=1.0
"""


def _flatten(config):
    """Nested config.json -> the flat value-map renderTritonExecutionCfg consumes.
    Mirrors ProjectManager.ts:582-637 (input.* / settings.* / compsetup.* /
    execution.*). Keys absent here fall back to the template default, exactly as the
    extension does when the corresponding project field is unset."""
    s = config.get("settings") or {}
    i = config.get("input") or {}
    c = config.get("compsetup") or {}
    e = config.get("execution") or {}
    return {
        "dem_filename": i.get("dem"),
        "h_infile": i.get("initialInput"),
        "qx_infile": i.get("qx_infile"),
        "qy_infile": i.get("qy_infile"),
        "src_loc_file": i.get("src_loc_file"),
        "hydrograph_filename": i.get("hydrograph_filename"),
        "num_sources": i.get("num_sources"),
        "input_format": s.get("input_format"),
        "output_format": s.get("output_format"),
        "courant": c.get("courant"),
        "sim_duration": c.get("sim_duration"),
        "sim_start_time": c.get("sim_start_time"),
        "time_step": c.get("time_step"),
        "time_increment_fixed": c.get("time_increment_fixed"),
        "checkpoint_id": c.get("checkpoint_id"),
        "it_count": c.get("it_count"),
        "gpu_direct_flag": c.get("gpu_direct_flag"),
        "domain_decomposition": c.get("domain_decomposition"),
        "factor_interval_domain_decomposition": c.get("factor_interval_domain_decomposition"),
        "open_boundaries": c.get("open_boundaries"),
        "print_option": e.get("print_option"),
        "print_interval": e.get("print_interval"),
        "print_observation": e.get("print_observation"),
        "projection": e.get("projection"),
        "output_option": e.get("output_option"),
        "outfile_pattern": e.get("outfile_pattern"),
        "it_print": e.get("it_print"),
    }


def render_cfg(config):
    """Fill CFG_TEMPLATE from the (nested) config. Same rules as
    renderTritonExecutionCfg: project value wins; else the template default; a line
    whose resolved value is empty is OMITTED entirely. Input paths stay RELATIVE so
    TRITON resolves them from the working directory."""
    values = _flatten(config)
    out = []
    for line in CFG_TEMPLATE.split("\n"):
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            out.append(line)
            continue
        key, _, default = trimmed.partition("=")
        key = key.strip()
        default = default.strip()
        val = values.get(key)
        resolved = ("%s" % val) if (val is not None and val != "") else default
        if resolved == "":
            continue
        out.append("%s=%s" % (key, resolved))
    return "\n".join(out)


def validate_manifest(manifest):
    """Port of src/services/projectArchive.ts validateManifest: refuse a manifest
    that is malformed or from a newer schema MAJOR than this tool supports."""
    if not isinstance(manifest, dict):
        raise ValueError("not a Triforge project archive (missing %s manifest)" % MANIFEST_ENTRY)
    sv = manifest.get("schemaVersion")
    pn = manifest.get("projectName")
    pid = manifest.get("projectId")
    if not (isinstance(sv, str) and sv) or not (isinstance(pn, str) and pn) or not (isinstance(pid, str) and pid):
        raise ValueError("invalid archive manifest: schemaVersion, projectName and projectId are required")
    try:
        major = int(sv.split(".")[0])
    except ValueError:
        raise ValueError("invalid archive manifest: schemaVersion %r is malformed" % sv)
    if major > int(SCHEMA_VERSION.split(".")[0]):
        raise ValueError(
            "archive schema %s is newer than the supported %s — update Triforge to use it" % (sv, SCHEMA_VERSION))
    return manifest


def entry_escapes(entry, dest_root):
    """Port of entryEscapes: True when writing `entry` under `dest_root` would land
    outside it. Rejects absolute paths, drive letters, NUL, and any '..' traversal
    that leaves the root, treating '\\' and '/' both as separators."""
    if not isinstance(entry, str) or entry == "" or "\x00" in entry:
        return True
    slashed = entry.replace("\\", "/")
    if slashed.startswith("/") or re.match(r"^[A-Za-z]:", slashed):
        return True
    depth = 0
    for seg in slashed.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            depth -= 1
            if depth < 0:
                return True
        else:
            depth += 1
    segments = [s for s in slashed.split("/") if s]
    resolved = os.path.abspath(os.path.join(dest_root, *segments))
    dest_abs = os.path.abspath(dest_root)
    rel = os.path.relpath(resolved, dest_abs)
    return rel == "." or rel.startswith("..") or os.path.isabs(rel)


def _fail(msg):
    sys.stderr.write("triforge-hpc: %s\n" % msg)
    sys.exit(1)


def _dedupe_dir(name):
    """First free ./<name>, ./<name>-2, ... (fs-safe)."""
    safe = re.sub(r'[\\/:*?"<>|\x00]', "_", name).strip() or "triforge-project"
    candidate = safe
    n = 2
    while os.path.exists(candidate):
        candidate = "%s-%d" % (safe, n)
        n += 1
    return candidate


def cmd_unpack(args):
    with zipfile.ZipFile(args.archive) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if MANIFEST_ENTRY not in names:
            _fail("missing %s — not a Triforge project archive" % MANIFEST_ENTRY)
        manifest = validate_manifest(json.loads(zf.read(MANIFEST_ENTRY)))
        if CONFIG_ENTRY not in names:
            _fail("missing %s in the archive" % CONFIG_ENTRY)
        config = json.loads(zf.read(CONFIG_ENTRY))
        dest = args.dest or _dedupe_dir(manifest["projectName"])
        os.makedirs(dest, exist_ok=True)
        for name in names:
            if entry_escapes(name, dest):
                _fail("archive entry escapes the destination folder: %s" % name)
        for name in names:
            target = os.path.join(dest, *name.split("/"))
            os.makedirs(os.path.dirname(target) or ".", exist_ok=True)
            with zf.open(name) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
    with open(os.path.join(dest, "triton_execution.cfg"), "w", encoding="utf-8") as f:
        f.write(render_cfg(config))
    os.makedirs(os.path.join(dest, "output"), exist_ok=True)
    print("Unpacked '%s' into %s" % (manifest["projectName"], dest))
    print("Next steps (run everything from inside this directory):")
    print("  1. cd %s" % dest)
    print("  2. build TRITON here — its build generates triton_run.sh + triton.exe")
    print("  3. ./triton_run.sh ./triton_execution.cfg [MPI_CMD]")
    print("     (arg 1 = the cfg; arg 2 = launcher, default 'srun -n 8'; outputs -> ./output/)")
    print("  4. back on your workstation: triforge-hpc.py pack %s" % dest)


# TRITON output layout (externals/triton/src/constants.h): output_folder default
# "output"; subdirs asc/bin write ".out", gtiff writes ".tif".
_OUTPUT_KINDS = (("ascii", "asc", ".out"), ("binary", "bin", ".out"), ("geotiff", "gtiff", ".tif"))


def discover_outputs(project_dir):
    """Scan <project_dir>/output/{asc,bin,gtiff}/ for TRITON grids and return
    project-relative POSIX paths grouped by kind (ascii/binary/geotiff)."""
    result = {"ascii": [], "binary": [], "geotiff": []}
    for kind, subdir, ext in _OUTPUT_KINDS:
        base = os.path.join(project_dir, "output", subdir)
        if not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base):
            for name in files:
                if name.endswith(ext):
                    rel = os.path.relpath(os.path.join(root, name), project_dir)
                    result[kind].append(rel.replace(os.sep, "/"))
        result[kind].sort()
    return result


def _read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --- selective packing via an INI include-config (stdlib configparser; any Python 3) ---

def _project_arc(project_dir, rel):
    """Resolve a project-relative path (tolerating a missing 'input/' prefix) to its
    arc name under project_dir, or None if it is not an existing file inside the dir."""
    rel = str(rel).replace("\\", "/").strip().lstrip("/")
    if not rel:
        return None
    for base in (project_dir, os.path.join(project_dir, "input")):
        full = os.path.join(base, *rel.split("/"))
        if os.path.isfile(full):
            arc = os.path.relpath(full, project_dir).replace(os.sep, "/")
            return None if entry_escapes(arc, project_dir) else arc
    return None


def referenced_inputs(config, project_dir):
    """The input files the project's config references (dem, sources, hydrograph, and
    any other path stored in the input section) that exist on disk -- the files a
    TRITON run needs. These are ALWAYS packed, even when an include-config narrows the
    set, so a selective pack can never drop a file the run depends on. Returns sorted,
    de-duplicated arc names."""
    seen, arcs = set(), []
    for value in (config.get("input") or {}).values():
        if not isinstance(value, str):
            continue
        arc = _project_arc(project_dir, value)
        if arc and arc not in seen:
            seen.add(arc)
            arcs.append(arc)
    arcs.sort()
    return arcs


def _classify_output(arc):
    """'ascii' | 'binary' | 'geotiff' for an output/{asc,bin,gtiff}/... arc, else None."""
    parts = arc.split("/")
    if len(parts) >= 2 and parts[0] == "output":
        return {"asc": "ascii", "bin": "binary", "gtiff": "geotiff"}.get(parts[1])
    return None


def _include_arc(full, project_abs, section):
    """Archive path for an included file, plus whether it lives inside the project
    dir. In-tree files keep their project-relative path; an out-of-tree (absolute)
    file has no project-relative home, so it is bundled as '<section>/<basename>'."""
    full_abs = os.path.abspath(full)
    try:
        rel = os.path.relpath(full_abs, project_abs)
    except ValueError:                       # different drive on Windows
        rel = os.pardir
    inside = not (rel == os.pardir or rel.startswith(os.pardir + os.sep) or os.path.isabs(rel))
    if inside:
        return True, rel.replace(os.sep, "/")
    seg = re.sub(r'[\\/:*?"<>|\x00]', "_", section).strip("._ ") or "extra"
    return False, "%s/%s" % (seg, os.path.basename(full_abs))


def load_include_config(path, project_dir):
    """Parse the INI include-config that selects which files to pack. Sections are
    organizational labels (e.g. [input], [output], [extra]); each entry is
    `label = path`, where path may be a glob. A RELATIVE path is resolved under the
    project dir (and must stay inside it). An ABSOLUTE path is included regardless of
    location and bundled under its section as '<section>/<basename>'. Returns sorted,
    de-duplicated (source_path, arc) pairs. A pattern matching nothing is warned about
    and skipped; a relative path that escapes the project dir, or two entries that map
    to the same archive path, are hard errors."""
    cp = configparser.ConfigParser(interpolation=None)
    cp.optionxform = str  # keep label case; labels are cosmetic
    try:
        with open(path, encoding="utf-8") as f:
            cp.read_file(f)
    except (OSError, configparser.Error) as exc:
        _fail("cannot read include-config %s: %s" % (path, exc))
    project_abs = os.path.abspath(project_dir)
    seen, pairs = {}, []
    for section in cp.sections():
        for label, value in cp.items(section):
            pattern = os.path.expanduser((value or "").strip())
            if not pattern:
                continue
            norm = pattern.replace("\\", "/")
            is_abs = os.path.isabs(pattern) or bool(re.match(r"^[A-Za-z]:", norm))
            if is_abs:
                matches = glob.glob(pattern, recursive=True)
            else:
                matches = glob.glob(os.path.join(project_dir, *norm.split("/")), recursive=True)
            files = sorted(m for m in matches if os.path.isfile(m))
            if not files:
                sys.stderr.write(
                    "triforge-hpc: warning: include-config [%s] %s matched no file: %s\n"
                    % (section, label, pattern))
                continue
            for full in files:
                inside, arc = _include_arc(full, project_abs, section)
                if not is_abs and not inside:
                    _fail("include-config [%s] %s: relative path escapes the project dir "
                          "(use an absolute path to include an out-of-tree file): %s"
                          % (section, label, pattern))
                if entry_escapes(arc, project_dir):
                    _fail("include-config [%s] %s resolves to an unsafe archive path: %s"
                          % (section, label, pattern))
                src = os.path.abspath(full)
                if arc in seen and seen[arc] != src:
                    _fail("include-config: two entries map to the same archive path %r "
                          "([%s] %s); rename one or place them in different sections"
                          % (arc, section, label))
                if arc not in seen:
                    seen[arc] = src
                    pairs.append((src, arc))
    pairs.sort(key=lambda t: t[1])
    return pairs


def cmd_pack(args):
    dest = args.dir
    manifest = validate_manifest(_read_json(os.path.join(dest, MANIFEST_ENTRY)))
    config = _read_json(os.path.join(dest, CONFIG_ENTRY))

    include_cfg = getattr(args, "include_config", None)
    listed = load_include_config(include_cfg, dest) if include_cfg else None  # [(source, arc)]
    listed_arcs = [arc for _src, arc in listed] if listed is not None else []

    # Outputs: honor explicit output/* entries from the include-config, else auto-discover.
    if listed is not None and any(_classify_output(a) for a in listed_arcs):
        outputs = {"ascii": [], "binary": [], "geotiff": []}
        for arc in listed_arcs:
            kind = _classify_output(arc)
            if kind:
                outputs[kind].append(arc)
        for kind in outputs:
            outputs[kind].sort()
    else:
        outputs = discover_outputs(dest)

    config.setdefault("output", {})
    config["output"]["ascii"] = outputs["ascii"]
    config["output"]["binary"] = outputs["binary"]
    config["output"]["geotiff"] = outputs["geotiff"]
    manifest["includesOutputs"] = True
    manifest["sourceOS"] = sys.platform
    manifest["exportedAt"] = datetime.now(timezone.utc).isoformat()
    out_tfp = args.output or os.path.join(
        os.path.dirname(os.path.abspath(dest)), "%s.tfp" % manifest["projectName"])

    # Ordered, de-duplicated (source, arc) plan to write (manifest + config separately).
    seen, plan = set(), []

    def _add(source, arc):
        if arc not in seen and os.path.isfile(source):
            seen.add(arc)
            plan.append((source, arc))

    def _add_local(arc):
        _add(os.path.join(dest, *arc.split("/")), arc)

    if listed is not None:
        # Replace + essentials: the include-config's files win on any arc collision,
        # then config-referenced inputs are always added so nothing the run needs is
        # dropped. Listed sources may be out-of-tree (absolute).
        for source, arc in listed:
            _add(source, arc)
        for arc in referenced_inputs(config, dest):
            _add_local(arc)
    else:
        # Default: everything under input/.
        for root, _dirs, files in os.walk(os.path.join(dest, "input")):
            for name in files:
                _add_local(os.path.relpath(os.path.join(root, name), dest).replace(os.sep, "/"))

    for kind in ("ascii", "binary", "geotiff"):
        for arc in outputs[kind]:
            _add_local(arc)

    with zipfile.ZipFile(out_tfp, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(MANIFEST_ENTRY, json.dumps(manifest, indent=2))
        zf.writestr(CONFIG_ENTRY, json.dumps(config, indent=2))
        for source, arc in plan:
            zf.write(source, arc)

    arcs = plan
    n_out = sum(len(outputs[k]) for k in outputs)
    tail = (" via include-config %s" % os.path.basename(include_cfg)) if include_cfg else ""
    print("Packed '%s' -> %s (%d file(s), %d output)%s"
          % (manifest["projectName"], out_tfp, len(arcs), n_out, tail))
    print("Import it in VS Code (Import Project...), confirm Merge, then animate the Output.")


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="triforge-hpc.py",
        description="Use a Triforge .tfp project on an HPC system without VS Code.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_unpack = sub.add_parser("unpack", help="unpack a .tfp into a runnable project layout")
    p_unpack.add_argument("archive", help="path to the .tfp archive")
    p_unpack.add_argument("--dest", default=None, help="destination dir (default: the project name)")
    p_unpack.set_defaults(func=cmd_unpack)

    p_pack = sub.add_parser("pack", help="pack a project dir's outputs into a re-importable .tfp")
    p_pack.add_argument("dir", help="the unpacked project directory")
    p_pack.add_argument("-o", "--output", default=None, help="output .tfp path (default: <name>.tfp)")
    p_pack.add_argument(
        "--include-config", dest="include_config", default=None, metavar="INI",
        help="INI file selecting which files to pack: each section (e.g. [input], "
             "[output], [extra]) holds 'label = path' entries (globs allowed). A "
             "relative path is taken under the project dir; an absolute path is "
             "included regardless of location, bundled as <section>/<basename>. "
             "Config-referenced input files are always included; outputs are "
             "auto-discovered unless the INI lists any.")
    p_pack.set_defaults(func=cmd_pack)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
