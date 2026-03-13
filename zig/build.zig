const std = @import("std");

pub fn build(b: *std.Build) void {
    // Native tests (default step)
    const test_step = b.step("test", "Run zerobuf unit tests");
    const target = b.standardTargetOptions(.{});
    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("zerobuf.zig"),
            .target = target,
        }),
    });
    const run_tests = b.addRunArtifact(tests);
    test_step.dependOn(&run_tests.step);
    b.default_step = test_step;
}
