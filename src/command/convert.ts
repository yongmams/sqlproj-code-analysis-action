import fs from "fs";
import path from "path";
import { convert2sarfi } from "./types/tools.interface";
import { convertMsBuildXml } from "./dac/msbuild-convert";
import { Sarif } from "./sarif/sarif2";
import { ConvertOption, PostConvertOption } from "./types/convert-option";

export function convert(options?: ConvertOption): void {

    const opt = checkAndPostOptions(options);
    if (!opt) {
        return;
    }
    convertFileToSARIF(opt);
}

function checkAndPostOptions(options?: ConvertOption): PostConvertOption | null {

    if (!options) {
        console.error(`options is null.`)
        return null;
    }

    if (!options.SourcePath) {
        console.error(`SourcePath is null.`)
        return null;
    }

    if (path.extname(options.SourcePath).toLowerCase() != '.xml') {
        console.error(`${options.SourcePath} extname is not xml.`)
        return null;
    }

    if (!path.isAbsolute(options.SourcePath)) {
        options.SourcePath = path.resolve(options.SourcePath);
    }

    if (!fs.existsSync(options.SourcePath)) {
        console.error(`${options.SourcePath} is not exist.`)
        return null;
    }

    if (!options.SourceFormat) {
        options.SourceFormat = 'msbuild';
    }

    options.SourceFormat = options.SourceFormat.toLowerCase();
    if (options.SourceFormat != 'msbuild') {
        console.error(`${options.SourceFormat} is not supported.`)
        return null;
    }

    if (!options.OutfilePath) {
        options.OutfilePath = path.join(path.dirname(options.SourcePath), path.basename(options.SourcePath, '.xml')) + '.sarif';
    } else if (path.extname(options.OutfilePath).toLowerCase() != '.sarif') {
        options.OutfilePath = path.join(options.OutfilePath, path.basename(options.SourcePath, '.xml')) + '.sarif';
    }

    return {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        SourcePath: options.SourcePath,
        OutfilePath: options.OutfilePath,
        SourceFormat: options.SourceFormat
    };
}

function convertFileToSARIF(opt: PostConvertOption) {

    fs.readFile(opt.SourcePath, (err, data) => {

        if (err) {
            console.error(err);
        } else if (data.length == 0) {
            console.error('source file is empty.');
        } else {

            let converter: convert2sarfi;

            switch (opt.SourceFormat) {
                case 'msbuild':
                    converter = convertMsBuildXml;
                    break;
                default:
                    console.error(`${opt.SourceFormat} not implemented`);
                    return;
            }

            converter(data, (content: Sarif) => saveSARIF(content, opt));
        }
    });
}

function saveSARIF(sarif: Sarif, opt: PostConvertOption) {

    if (sarif) {
        const content = JSON.stringify(sarif);

        const dir = path.dirname(opt.OutfilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdir(dir, { recursive: true }, () => {
                writeFile(opt.OutfilePath, content);
            })
        } else {
            writeFile(opt.OutfilePath, content);
        }
    } else {
        console.error(`No files were generated.`);
    }
}

function writeFile(path: string, content: string) {

    fs.writeFile(path, content, { encoding: 'utf-8' }, () => {
        console.log(`${path} were generated`);
    });
}





