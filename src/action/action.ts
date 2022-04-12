import * as  core from '@actions/core';
import { scan } from '../command/scan';

try {
    const sourcefile = core.getInput('source-path');
    const outfile = core.getInput('outfile-path');
    const args = core.getInput('msubild-arguments');

    scan({
        SourcePath: sourcefile,
        OutfilePath: outfile,
        Arguments: args
    })

} catch (error: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    core.setFailed(error.message as string);
}