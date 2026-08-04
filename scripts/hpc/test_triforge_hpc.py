import importlib.util
import os
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("triforge_hpc", os.path.join(_HERE, "triforge-hpc.py"))
tfh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tfh)


class TestManifest(unittest.TestCase):
    def test_accepts_a_valid_manifest(self):
        m = {"schemaVersion": "1.0.0", "projectName": "p", "projectId": "id", "includesOutputs": False}
        self.assertEqual(tfh.validate_manifest(m)["projectName"], "p")

    def test_rejects_non_dict(self):
        with self.assertRaises(ValueError):
            tfh.validate_manifest("nope")

    def test_rejects_missing_required_fields(self):
        with self.assertRaises(ValueError):
            tfh.validate_manifest({"schemaVersion": "1.0.0", "projectName": "p"})

    def test_rejects_newer_major(self):
        with self.assertRaises(ValueError):
            tfh.validate_manifest({"schemaVersion": "2.0.0", "projectName": "p", "projectId": "id"})


class TestEntryEscapes(unittest.TestCase):
    def test_ok_relative_entry(self):
        self.assertFalse(tfh.entry_escapes("input/dem.asc", "/tmp/proj"))

    def test_absolute_rejected(self):
        self.assertTrue(tfh.entry_escapes("/etc/passwd", "/tmp/proj"))

    def test_drive_letter_rejected(self):
        self.assertTrue(tfh.entry_escapes("C:/x", "/tmp/proj"))

    def test_dotdot_escape_rejected(self):
        self.assertTrue(tfh.entry_escapes("../../secret", "/tmp/proj"))

    def test_nul_rejected(self):
        self.assertTrue(tfh.entry_escapes("a\x00b", "/tmp/proj"))

    def test_empty_rejected(self):
        self.assertTrue(tfh.entry_escapes("", "/tmp/proj"))


class TestRenderCfg(unittest.TestCase):
    CONFIG = {
        "settings": {"input_format": "ASC", "output_format": "ASC"},
        "input": {"dem": "input/HawRidgePark.asc", "num_sources": 1,
                  "src_loc_file": "input/HawRidgePark.src",
                  "hydrograph_filename": "input/HawRidgePark.hyg"},
        "output": {"output_directory": "output"},
        "compsetup": {"courant": 0.5, "sim_duration": 86400, "sim_start_time": 0,
                      "checkpoint_id": 0, "it_count": 0, "gpu_direct_flag": 0,
                      "domain_decomposition": "static",
                      "factor_interval_domain_decomposition": 1, "open_boundaries": 1,
                      "time_increment_fixed": 0},
        "execution": {"print_option": "huv", "print_interval": 900, "print_observation": 1,
                      "projection": "EPSG:32616", "output_option": "PAR",
                      "outfile_pattern": "%s/%s/%s_%02d_%02d", "it_print": 3600},
    }

    def test_input_paths_stay_relative(self):
        cfg = tfh.render_cfg(self.CONFIG)
        self.assertIn("dem_filename=input/HawRidgePark.asc", cfg)
        self.assertIn("src_loc_file=input/HawRidgePark.src", cfg)
        self.assertIn("hydrograph_filename=input/HawRidgePark.hyg", cfg)

    def test_scalars_from_nested_sections(self):
        cfg = tfh.render_cfg(self.CONFIG)
        self.assertIn("num_sources=1", cfg)          # from input.*
        self.assertIn("courant=0.5", cfg)            # from compsetup.*
        self.assertIn("print_option=huv", cfg)       # from execution.*
        self.assertIn("input_format=ASC", cfg)       # from settings.*

    def test_numeric_zero_renders_not_dropped(self):
        # checkpoint_id=0 must appear (0 is a real value, not empty).
        self.assertIn("checkpoint_id=0", tfh.render_cfg(self.CONFIG))

    def test_empty_input_lines_omitted(self):
        # No initialInput / qx / qy in CONFIG -> those lines are omitted, not "h_infile=".
        cfg = tfh.render_cfg(self.CONFIG)
        self.assertNotIn("h_infile=", cfg)
        self.assertNotIn("qx_infile=", cfg)

    def test_embedded_template_matches_repo_source(self):
        repo_root = os.path.abspath(os.path.join(_HERE, "..", ".."))
        with open(os.path.join(repo_root, "resources", "triton_execution.cfg.template"), encoding="utf-8") as f:
            on_disk = f.read()
        self.assertEqual(tfh.CFG_TEMPLATE.rstrip("\n"), on_disk.rstrip("\n"))


import io
import json as _json
import tempfile
import zipfile as _zip


def _make_tfp(path, include_outputs=False):
    """Build a minimal valid .tfp (inputs-only by default) for tests."""
    manifest = {"schemaVersion": "1.0.0", "exportedAt": "2026-07-14T00:00:00Z",
                "projectName": "HawRidgePark", "projectId": "test-id-123",
                "includesOutputs": include_outputs, "sourceOS": "linux"}
    config = dict(TestRenderCfg.CONFIG)
    config["settings"] = {"id": "test-id-123", "name": "HawRidgePark",
                          "input_format": "ASC", "output_format": "ASC"}
    with _zip.ZipFile(path, "w") as zf:
        zf.writestr("triforge.export.json", _json.dumps(manifest))
        zf.writestr("config.json", _json.dumps(config))
        zf.writestr("input/HawRidgePark.asc", "ncols 2\nnrows 2\n1 2\n3 4\n")
        zf.writestr("input/HawRidgePark.src", "1\n0 0\n")
        zf.writestr("input/HawRidgePark.hyg", "0 1.0\n")


class TestUnpack(unittest.TestCase):
    def test_unpack_lays_out_a_runnable_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            tfp = os.path.join(tmp, "p.tfp")
            _make_tfp(tfp)
            dest = os.path.join(tmp, "proj")
            tfh.cmd_unpack(argparse_ns(archive=tfp, dest=dest))
            self.assertTrue(os.path.isfile(os.path.join(dest, "triton_execution.cfg")))
            # No run.sh is generated: TRITON's own build writes triton_run.sh, which
            # the user invokes with our triton_execution.cfg.
            self.assertFalse(os.path.exists(os.path.join(dest, "run.sh")))
            self.assertTrue(os.path.isdir(os.path.join(dest, "output")))
            self.assertTrue(os.path.isfile(os.path.join(dest, "input", "HawRidgePark.asc")))
            self.assertTrue(os.path.isfile(os.path.join(dest, "triforge.export.json")))
            with open(os.path.join(dest, "triton_execution.cfg")) as f:
                self.assertIn("dem_filename=input/HawRidgePark.asc", f.read())

    def test_unpack_refuses_zip_slip(self):
        with tempfile.TemporaryDirectory() as tmp:
            tfp = os.path.join(tmp, "evil.tfp")
            with _zip.ZipFile(tfp, "w") as zf:
                zf.writestr("triforge.export.json", _json.dumps(
                    {"schemaVersion": "1.0.0", "projectName": "x", "projectId": "x"}))
                zf.writestr("config.json", "{}")
                zf.writestr("../escape.txt", "pwned")
            with self.assertRaises(SystemExit):
                tfh.cmd_unpack(argparse_ns(archive=tfp, dest=os.path.join(tmp, "d")))


def argparse_ns(**kw):
    import argparse as _a
    return _a.Namespace(**kw)


class TestPackRoundTrip(unittest.TestCase):
    def _simulate_outputs(self, dest):
        # TRITON (run from the project root, output_folder default "output") writes:
        #   output/asc/*.out, output/bin/*.out, output/gtiff/*.tif
        os.makedirs(os.path.join(dest, "output", "asc"), exist_ok=True)
        os.makedirs(os.path.join(dest, "output", "gtiff"), exist_ok=True)
        with open(os.path.join(dest, "output", "asc", "H_01_00.out"), "w") as f:
            f.write("grid\n")
        with open(os.path.join(dest, "output", "gtiff", "H_01_00.tif"), "wb") as f:
            f.write(b"\x49\x49")

    def test_discover_outputs_classifies_by_subdir(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._simulate_outputs(tmp)
            found = tfh.discover_outputs(tmp)
            self.assertIn("output/asc/H_01_00.out", found["ascii"])
            self.assertIn("output/gtiff/H_01_00.tif", found["geotiff"])
            self.assertEqual(found["binary"], [])

    def test_pack_produces_a_reimportable_tfp(self):
        with tempfile.TemporaryDirectory() as tmp:
            tfp = os.path.join(tmp, "p.tfp")
            _make_tfp(tfp)
            dest = os.path.join(tmp, "proj")
            tfh.cmd_unpack(argparse_ns(archive=tfp, dest=dest))
            self._simulate_outputs(dest)
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out))
            self.assertTrue(os.path.isfile(out))
            with _zip.ZipFile(out) as zf:
                names = zf.namelist()
                self.assertIn("triforge.export.json", names)
                self.assertIn("output/asc/H_01_00.out", names)
                self.assertIn("input/HawRidgePark.asc", names)
                manifest = _json.loads(zf.read("triforge.export.json"))
                config = _json.loads(zf.read("config.json"))
            # Re-validates, keeps identity, flips includesOutputs, records outputs relative.
            tfh.validate_manifest(manifest)
            self.assertTrue(manifest["includesOutputs"])
            self.assertEqual(manifest["projectId"], "test-id-123")
            self.assertIn("output/asc/H_01_00.out", config["output"]["ascii"])
            self.assertIn("output/gtiff/H_01_00.tif", config["output"]["geotiff"])


import subprocess
import sys


class TestCli(unittest.TestCase):
    def test_help_runs(self):
        r = subprocess.run([sys.executable, os.path.join(_HERE, "triforge-hpc.py"), "--help"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn("unpack", r.stdout)
        self.assertIn("pack", r.stdout)

    def test_end_to_end_via_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            tfp = os.path.join(tmp, "p.tfp")
            _make_tfp(tfp)
            dest = os.path.join(tmp, "proj")
            tool = os.path.join(_HERE, "triforge-hpc.py")
            r1 = subprocess.run([sys.executable, tool, "unpack", tfp, "--dest", dest],
                                capture_output=True, text=True)
            self.assertEqual(r1.returncode, 0, r1.stderr)
            os.makedirs(os.path.join(dest, "output", "asc"), exist_ok=True)
            with open(os.path.join(dest, "output", "asc", "H_01_00.out"), "w") as f:
                f.write("g\n")
            out = os.path.join(tmp, "o.tfp")
            r2 = subprocess.run([sys.executable, tool, "pack", dest, "-o", out],
                                capture_output=True, text=True)
            self.assertEqual(r2.returncode, 0, r2.stderr)
            self.assertTrue(os.path.isfile(out))


class TestPackIncludeConfig(unittest.TestCase):
    def _unpack(self, tmp):
        tfp = os.path.join(tmp, "p.tfp")
        _make_tfp(tfp)
        dest = os.path.join(tmp, "proj")
        tfh.cmd_unpack(argparse_ns(archive=tfp, dest=dest))
        return dest

    def _write(self, path, data="x\n"):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w") as f:
            f.write(data)

    def _names(self, tfp_path):
        with _zip.ZipFile(tfp_path) as zf:
            return zf.namelist()

    def test_referenced_inputs_are_the_config_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            with open(os.path.join(dest, "config.json")) as f:
                config = _json.load(f)
            self.assertEqual(
                tfh.referenced_inputs(config, dest),
                ["input/HawRidgePark.asc", "input/HawRidgePark.hyg", "input/HawRidgePark.src"])

    def test_replace_keeps_essentials_drops_unlisted_adds_listed(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(dest, "input", "scratch.tmp"))   # non-essential, unlisted
            self._write(os.path.join(dest, "notes.txt"), "hello\n")   # listed extra
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[extra]\nnotes = notes.txt\n")
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))
            names = self._names(out)
            for essential in ("input/HawRidgePark.asc", "input/HawRidgePark.src",
                              "input/HawRidgePark.hyg"):
                self.assertIn(essential, names)              # essentials always packed
            self.assertIn("notes.txt", names)                # listed extra packed
            self.assertNotIn("input/scratch.tmp", names)     # unlisted non-essential dropped
            self.assertIn("triforge.export.json", names)
            self.assertIn("config.json", names)

    def test_explicit_outputs_override_autodiscovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(dest, "output", "asc", "H_01_00.out"), "g\n")
            self._write(os.path.join(dest, "output", "asc", "H_02_00.out"), "g\n")
            self._write(os.path.join(dest, "output", "bin", "H_01_00.out"), "g\n")
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[output]\ndepth = output/asc/H_01_00.out\n")
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))
            names = self._names(out)
            self.assertIn("output/asc/H_01_00.out", names)
            self.assertNotIn("output/asc/H_02_00.out", names)   # not listed -> excluded
            self.assertNotIn("output/bin/H_01_00.out", names)   # not listed -> excluded
            with _zip.ZipFile(out) as zf:
                config = _json.loads(zf.read("config.json"))
            self.assertEqual(config["output"]["ascii"], ["output/asc/H_01_00.out"])
            self.assertEqual(config["output"]["binary"], [])

    def test_outputs_autodiscovered_when_ini_lists_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(dest, "output", "asc", "H_01_00.out"), "g\n")
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[input]\ndem = input/HawRidgePark.asc\n")   # no output section
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))
            self.assertIn("output/asc/H_01_00.out", self._names(out))     # auto-discovered

    def test_glob_pattern_matches_multiple(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(dest, "input", "roff_1.bin"))
            self._write(os.path.join(dest, "input", "roff_2.bin"))
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[input]\nrunoff = input/roff_*.bin\n")
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))
            names = self._names(out)
            self.assertIn("input/roff_1.bin", names)
            self.assertIn("input/roff_2.bin", names)

    def test_absolute_out_of_tree_file_is_bundled_under_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            ext = os.path.join(tmp, "external", "shared.bin")   # outside the project dir
            self._write(ext, "external-data\n")
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[input]\nshared = %s\n" % ext)    # absolute path
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))
            with _zip.ZipFile(out) as zf:
                names = zf.namelist()
                self.assertIn("input/shared.bin", names)        # <section>/<basename>
                self.assertEqual(zf.read("input/shared.bin"), b"external-data\n")
            for essential in ("input/HawRidgePark.asc", "input/HawRidgePark.src"):
                self.assertIn(essential, names)                 # essentials still there

    def test_absolute_glob_out_of_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(tmp, "shared", "a.bin"))
            self._write(os.path.join(tmp, "shared", "b.bin"))
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[extra]\nblobs = %s\n" % os.path.join(tmp, "shared", "*.bin"))
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))
            names = self._names(out)
            self.assertIn("extra/a.bin", names)
            self.assertIn("extra/b.bin", names)

    def test_relative_escape_still_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(tmp, "secret.txt"))        # one level above dest
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[x]\nleak = ../secret.txt\n")     # relative escape
            out = os.path.join(tmp, "out.tfp")
            with self.assertRaises(SystemExit):
                tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))

    def test_colliding_arcs_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(tmp, "one", "dup.bin"), "1\n")
            self._write(os.path.join(tmp, "two", "dup.bin"), "2\n")
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[extra]\na = %s\nb = %s\n"
                        % (os.path.join(tmp, "one", "dup.bin"), os.path.join(tmp, "two", "dup.bin")))
            out = os.path.join(tmp, "out.tfp")
            with self.assertRaises(SystemExit):                 # both -> extra/dup.bin
                tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))

    def test_no_match_warns_but_still_packs_essentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[input]\nmissing = input/does_not_exist.bin\n")
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))   # no raise
            self.assertIn("input/HawRidgePark.asc", self._names(out))

    def test_reimportable_after_selective_pack(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[input]\ndem = input/HawRidgePark.asc\n")
            out = os.path.join(tmp, "out.tfp")
            tfh.cmd_pack(argparse_ns(dir=dest, output=out, include_config=ini))
            dest2 = os.path.join(tmp, "proj2")
            tfh.cmd_unpack(argparse_ns(archive=out, dest=dest2))
            self.assertTrue(os.path.isfile(os.path.join(dest2, "input", "HawRidgePark.asc")))
            self.assertTrue(os.path.isfile(os.path.join(dest2, "triton_execution.cfg")))

    def test_cli_include_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self._unpack(tmp)
            self._write(os.path.join(dest, "notes.txt"), "n\n")
            ini = os.path.join(tmp, "inc.ini")
            self._write(ini, "[extra]\nnotes = notes.txt\n")
            out = os.path.join(tmp, "o.tfp")
            tool = os.path.join(_HERE, "triforge-hpc.py")
            r = subprocess.run(
                [sys.executable, tool, "pack", dest, "-o", out, "--include-config", ini],
                capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("notes.txt", self._names(out))


if __name__ == "__main__":
    unittest.main()
