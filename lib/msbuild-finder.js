'use strict';

var path = require('path');
var gutil = require('gulp-util');
var constants = require('./constants');
var fs = require('fs');
var PluginError = gutil.PluginError;
var child = require ('child_process');

var msBuildFromWhere = function(pathRoot, version) {
  var vsWherePath = path.join(pathRoot, 'Microsoft Visual Studio','Installer', 'vswhere.exe');
  var whereProcessArgumentsBase =  ['-products', '*', '-requires', 'Microsoft.Component.MSBuild'];
  var whereProcessArgumentsVerioning = ['-latest'];
  
  var versionNumber = new Number(version);
  if (version !== 'optional')
  {
      if (versionNumber == NaN) return ''; // not optional parameter, probably .NET framework version was passed

      whereProcessArgumentsVerioning = ['-version', `[${version},${(versionNumber+1).toFixed(1)})`]
  }

  var whereProcess = child.spawnSync(vsWherePath,
    whereProcessArgumentsBase.concat(whereProcessArgumentsVerioning),
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe',
      encoding: 'utf-8'
    }
  );

  var cmdOutput = '';
  if (whereProcess.output === null) {
    return '';
  }
  if (whereProcess.output.length > 0){
    for (var index = 0; index < whereProcess.output.length; index++) {
      cmdOutput = whereProcess.output[index] || '';
      if (cmdOutput.length > 0) {
        break;
      }
    }
  }

  var installKeyword = 'installationPath';
  if (cmdOutput.length > 0) {
    var results = cmdOutput.split(/\r?\n/);
    for (var cmdLineIndex = 0; cmdLineIndex < results.length; cmdLineIndex++) {
      var cmdLine = results[cmdLineIndex];
      if (cmdLine.startsWith(installKeyword)) {
        var match = cmdLine.replace(installKeyword + ': ', '');
        return match;
      }
    }
  }
  return '';
}

var detectMsBuildDir = function (pathRoot, version) {
  version = version || 'optional';

  var wherePath = msBuildFromWhere(pathRoot, version) || '';
  if (wherePath.length > 0) {
    return wherePath;
  }


  var vs2017Path = path.join(pathRoot, 'Microsoft Visual Studio', convertVSVersionToYearVariant(version));
  var possibleFolders = ['BuildTools', 'Enterprise', 'Professional', 'Community'];

  for (var index = 0; index < possibleFolders.length; index++) {
    try {
      var folderPath = path.join(vs2017Path, possibleFolders[index]);
      var folderPathWithVersioning = (version === 'optional' ? folderPath : path.join(folderPath, 'MSBuild', convertVSVersionToFolderName(version).toString()));

      fs.statSync(folderPathWithVersioning)
      return folderPath;
    } catch (e) {}
  }
}

// Use MSBuild over XBuild where possible
var detectMsBuildOverXBuild = function () {
  try {
    var output = child.spawnSync('which', ['msbuild'], {encoding: 'utf8'});
    if (output.stderr && output.stderr !== 0) {
      return 'xbuild';
    }
    return 'msbuild';
  } catch (e) {}
}

var autoDetectVersion = function (pathRoot) {
  // Try to detect MSBuild 15.0.
  var msbuild15 = constants.MSBUILD_VERSIONS[15.0];
  var msbuild15Dir = detectMsBuildDir(pathRoot, msbuild15);
  if (msbuild15Dir) {
    return [msbuild15Dir, msbuild15];
  }

  // Detect MSBuild lower than 15.0.
  // ported from https://github.com/stevewillcock/grunt-msbuild/blob/master/tasks/msbuild.js#L167-L181
  var msbuildDir = path.join(pathRoot, 'MSBuild');
  var msbuildDirExists = true;

  try {
    fs.statSync(msbuildDir);
  } catch (e) {
    msbuildDirExists = false;
  }

  if (msbuildDirExists) {
    var msbuildVersions = fs.readdirSync(msbuildDir)
      .filter(function (entryName) {
        var binDirExists = true;
        var binDirPath = path.join(msbuildDir, entryName, 'Bin');
        try {
          fs.statSync(binDirPath);
        } catch (e) {
          binDirExists = false;
        }

        return entryName.indexOf('1') === 0 && binDirExists;
      });

    if (msbuildVersions.length > 0) {
      // Return latest installed msbuild version
      return [pathRoot, parseFloat(msbuildVersions.pop())];
    }
  }

  return [pathRoot, 4.0];
};

var convertVSVersionToFolderName = function (version) {
  // in VS2019 (16.0) the path to MSBuild has changed from version number to 'Current'
  switch (version.toString())
  {
    case '16.0':
      return 'Current';
  }
  return version;
}

var convertVSVersionToYearVariant = function (version ) {
  switch (version.toString())
  {
    case '12.0':
      return '2013';
    case '14.0':
      return '2015';
    case '15.0':
      return '2017';
    case '16.0':
      return '2019';
  }
  return version;
}

module.exports.find = function (options) {
  if (options.platform.match(/linux|darwin/)) {
    var msbuildPath = detectMsBuildOverXBuild();
    if (msbuildPath) {
      return msbuildPath;
    }
    return 'xbuild';
  } else if (!options.platform.match(/^win/)) {
    return 'xbuild';
  }

  var msbuildRoot;
  var is64Bit = options.architecture === 'x64';

  // On 64-bit systems msbuild is always under the x86 directory. If this
  // doesn't exist we are on a 32-bit system. See also:
  // https://blogs.msdn.microsoft.com/visualstudio/2013/07/24/msbuild-is-now-part-of-visual-studio/
  var pathRoot;
  if (is64Bit) {
    pathRoot = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  } else {
    pathRoot = process.env['ProgramFiles'] || 'C:/Program Files';
  }

  if (options.toolsVersion === 'auto') {
    var result = autoDetectVersion(pathRoot);
    msbuildRoot = result[0]
    options.toolsVersion = result[1];
  } else {
      var msbuildDir = detectMsBuildDir(pathRoot, constants.MSBUILD_VERSIONS[options.toolsVersion]);
      if (msbuildDir) {
        msbuildRoot = msbuildDir;
      } else {
        msbuildRoot = pathRoot;
      }
  }

  var version = constants.MSBUILD_VERSIONS[options.toolsVersion];
  if (!version) {
    throw new PluginError(constants.PLUGIN_NAME, 'No MSBuild Version was supplied!');
  }

  if (version === '12.0' || version === '14.0' || version === '15.0' || version === '16.0') {
    var x64_dir = is64Bit ? 'amd64' : '';
    version = convertVSVersionToFolderName(version);

    return path.join(msbuildRoot, 'MSBuild', version, 'Bin', x64_dir, 'MSBuild.exe');
  } else {
    var framework = is64Bit ? 'Framework64' : 'Framework';
    return path.join(options.windir, 'Microsoft.Net', framework, version, 'MSBuild.exe');
  }
};