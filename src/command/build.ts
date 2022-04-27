import { exec, ExecOptions } from "@actions/exec";
import fs from "fs";
import path from "path";
import iconv from 'iconv-lite';
import { BuildOption, PostBuildOption } from "./types/build-option";
import { WhereOption } from "./types/where-option";
import { appWhere } from "./where";
import { generateFullNameWithNumber } from "./unit";
import { convertMsBuildWarning } from "./dac/msbuild-convert";
import { Sarif } from "./sarif/sarif2";

export function build(options?: BuildOption, callback?: (dacpacPath: string[], analysisResultPath: string[]) => void): void {

    const opt = checkAndPostOptions(options);
    if (!opt) {
        return;
    }

    const dacpacPath: string[] = [];
    const analysisResultPath: string[] = [];
    const warnings: string[] = [];

    const whereOpts = generateWhereOptions(opt);
    appWhere(whereOpts, msbuild => {

        let command = `${opt.SourcePath}`
        if (opt.Arguments) {
            command += ` ${opt.Arguments}`
        }

        const options: ExecOptions = { silent: true, failOnStdErr: true }
        options.listeners = {
            stdout: (stdout: Buffer) => {
                const data = iconv.decode(stdout, 'cp936');
                const lines = data?.split('\r\n');

                if (lines) {

                    for (let i = 0; i < lines.length; i++) {
                        const row = lines[i];

                        if (opt.HideStaticCodeAnalysis && row.includes('StaticCodeAnalysis warning')) {
                            continue;
                        } else if (opt.CollectWarning && row.includes('warning')) {
                            warnings.push(row);
                            continue;
                        } else {
                            console.log(row);
                        }

                        const dacpacMatchr = row.match(/(?<=->\s{1}).*(?<=\.dacpac)/g);
                        if (dacpacMatchr && dacpacMatchr[0]) {
                            dacpacPath.push(dacpacMatchr[0]);
                            continue;
                        }

                        const xmlMatchr = row.match(/(?<=The results are saved in ).*(?<=\.StaticCodeAnalysis\.Results\.xml)/g);
                        if (xmlMatchr && xmlMatchr[0]) {
                            analysisResultPath.push(xmlMatchr[0]);
                            continue;
                        }
                    }
                }
            }
        };

        exec(`"${msbuild}" ${command}`, [], options)
            .then(res => {

                if (res != 0) {
                    throw 'build failed.';
                }

                const dacpacPathr: string[] = generateDacpacResult(dacpacPath, opt);
                const analysisResultPathr: string[] = generateAnalysisResult(analysisResultPath, opt);
                generateWarningResult(warnings, opt, dacpacPathr, analysisResultPathr);

                if (callback) {
                    callback(dacpacPathr, analysisResultPathr);
                }
            })
            .catch(reason => {
                console.error(reason);
                process.exit(1);
            });

    });
}

function generateDacpacResult(dacpacPath: string[], opt: PostBuildOption): string[] {
    const dacpacPathr: string[] = [];

    dacpacPath.forEach((dac, index) => {
        if (opt.OutfilePath && fs.existsSync(dac)) {
            const fullName = generateFullNameWithNumber(opt.OutfilePath, '.dacpac', index, path.basename(dac, '.dacpac'));
            fs.copyFileSync(dac, fullName);
            console.log(`the dacpac file path: ${fullName}`);
            dacpacPathr.push(fullName);
        } else {
            console.log(`the dacpac file path: ${dac}`);
            dacpacPathr.push(dac);
        }
    });

    return dacpacPathr;
}

function generateAnalysisResult(analysisResultPath: string[], opt: PostBuildOption): string[] {
    const analysisResultPathr: string[] = [];

    analysisResultPath.forEach((report, index) => {
        if (opt.AnalysisResultPath && fs.existsSync(report)) {
            const fullName = generateFullNameWithNumber(opt.AnalysisResultPath, '.xml', index, path.basename(report, '.xml'));
            fs.copyFileSync(report, fullName);
            console.log(`the static analysis result file path: ${fullName}`);
            analysisResultPathr.push(fullName);
        } else {
            console.log(`the static analysis result file path: ${report}`);
            analysisResultPathr.push(report);
        }
    });

    return analysisResultPathr;
}

function generateWarningResult(warnings: string[], opt: PostBuildOption, analysisResultPath: string[], dacpacPath: string[]) {

    let fullName = opt.AnalysisResultPath || opt.OutfilePath;
    if (!fullName && analysisResultPath.length > 0) {
        fullName = analysisResultPath[0];
    }
    if (!fullName && dacpacPath.length > 0) {
        fullName = dacpacPath[0];
    }
    if (!fullName) { return; }

    if (path.extname(fullName).toLowerCase() == '.xml' || path.extname(fullName).toLowerCase() == '.dacpac') {
        fullName = path.basename(fullName) + '.sarif';
    } else {
        fullName = path.join(fullName, 'warnings.sarif');
    }

    if (warnings && warnings.length > 0 && opt.AnalysisResultPath) {
        convertMsBuildWarning(warnings, (content: Sarif) => {
            if (fullName) {
                console.log(`the warning result file path: ${fullName}`);
                fs.writeFileSync(fullName, JSON.stringify(content));
            }
        });
    }
}

function checkAndPostOptions(options?: BuildOption): PostBuildOption | null {

    if (!options) {
        console.error(`options is null.`)
        return null;
    }

    if (!options.SourcePath) {
        console.error(`Target is null, sqlproj file path must be specified.`)
        return null;
    }

    if (!['.sqlproj', '.sln'].includes(path.extname(options.SourcePath).toLowerCase())) {
        console.error(`${options.SourcePath} extname is not sqlproj.`)
        return null
    }

    if (!path.isAbsolute(options.SourcePath)) {
        options.SourcePath = path.resolve(options.SourcePath);
    }

    if (!fs.existsSync(options.SourcePath)) {
        console.error(`${options.SourcePath} is not exist.`)
        return null;
    }

    if (options.OutfilePath && !path.isAbsolute(options.OutfilePath)) {
        options.OutfilePath = path.resolve(options.OutfilePath);
    }

    if (options.AnalysisResultPath) {
        if (!path.isAbsolute(options.AnalysisResultPath)) {
            options.AnalysisResultPath = path.resolve(options.AnalysisResultPath);
        }
    }

    if (!options.AnalysisResultPath && options.OutfilePath) {

        if (path.extname(options.OutfilePath).toLowerCase() == '.dacpac') {
            options.AnalysisResultPath = path.join(path.dirname(options.OutfilePath), path.basename(options.OutfilePath, '.dacpac')) + '.xml';
        } else {
            options.AnalysisResultPath = options.OutfilePath;
        }
    }

    options.VsVersion = options.VsVersion || 'latest';

    const collectWarning = options.CollectWarning !== false && options.CollectWarning !== 'false';
    const hideStaticCodeAnalysis = options.HideStaticCodeAnalysis !== false && options.HideStaticCodeAnalysis !== 'false';

    return {
        SourcePath: options.SourcePath,
        Arguments: options.Arguments,
        OutfilePath: options.OutfilePath,
        AnalysisResultPath: options.AnalysisResultPath,
        CollectWarning: collectWarning,
        HideStaticCodeAnalysis: hideStaticCodeAnalysis,
        VsVersion: options.VsVersion
    }
}

function generateWhereOptions(opt: PostBuildOption): WhereOption {

    return {
        Target: 'msbuild',
        VsVersion: opt.VsVersion
    }
}

