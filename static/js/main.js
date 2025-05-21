Vue.createApp({
    data() {
        // 从本地存储读取配置，如果没有则使用默认值
        const savedConfig = JSON.parse(localStorage.getItem('supertv_downloadconfig') || '{}');
        const defaultConfig = {
            type: 'TS',
            stream: false
        };
        const mergedConfig = {
            ...defaultConfig,
            ...savedConfig
        };

        return {
            currTask: {}, // 正在处理的任务
            tasks: [], // 任务队列
            rangeDownload: { // 特定范围下载
                isShowRange: false, // 是否显示范围下载
                startSegment: 1, // 起始片段
                endSegment: '', // 截止片段
            },
            paste: true, // 是否监听粘贴内容
            isCheckedAll: false, // 是否全选
            urlError: false, // 地址错误
            url: '', // 在线链接
            title: '', // 视频标题
            segment: {}, // 视频片段
            isSupperStreamWrite: window.streamSaver && !window.streamSaver.useBlobFallback, // 当前浏览器是否支持流式下载
            type: mergedConfig.type || 'TS', // 保存格式
            stream: mergedConfig.stream || false, // 是否视频流下载
            dp: null, // DPlayer
            loadingIndex: null,
            messageList: {}, // 消息列表
            modalList: {
                'modal-add': {},
                'modal-setting': {},
                'modal-segment': {},
                'modal-range': {},
                'modal-player': {},
                'modal-help': {},
                'modal-stream-select': {},
            },
            streams: [], // 可用流列表
            masterUrl: '', // 主播放列表的URL
            masterTitle: '', // 主播放列表的标题
            isForRangeDownload: false, // 标记是否为范围下载
        };
    },

    created() {
        // 初始化所有modalList的值为关闭状态
        for (let key in this.modalList) {
            this.modalList[key] = {
                show: false,
                showing: false,
                closing: false
            };
        }

        // 监听粘贴事件
        document.addEventListener('paste', this.onPaste);
        this.checkUrlParams();
    },

    beforeUnmount() {
        // 移除监听
        document.removeEventListener('paste', this.onPaste);
    },

    computed: {
        // 获取进度百分比
        getProgress() {
            return (item) => {
                if (item.rangeDownload && item.rangeDownload.targetSegment) {
                    return (item.finishNum / item.rangeDownload.targetSegment * 100).toFixed(2);
                } else {
                    return 0.00;
                }
            };
        },

        isChecked() {
            return this.tasks.some(item => item.checked);
        },

        isAllChecked() {
            this.isCheckedAll = this.tasks.every(item => item.checked);
            return this.isCheckedAll;
        }
    },

    watch: {
        type(newVal) {
            this.saveConfigToLocalStorage();
        },
        stream(newVal) {
            this.saveConfigToLocalStorage();
        }
    },

    methods: {
        // 保存配置到本地存储
        saveConfigToLocalStorage() {
            const config = {
                type: this.type,
                stream: this.stream
            };
            localStorage.setItem('supertv_downloadconfig', JSON.stringify(config));
        },

        // 检查URL参数并初始化
        checkUrlParams() {
            const urlParams = new URLSearchParams(window.location.search);
            const m3u8Url = urlParams.get('m3u8url');
            const m3u8Title = urlParams.get('m3u8title');
            if (m3u8Url) {
                // URL解码参数
                this.url = decodeURIComponent(m3u8Url);
                this.title = m3u8Title ? decodeURIComponent(m3u8Title) : '';
                // 自动打开下载弹窗并填充数据
                this.add(true);
            } else {
                // 如果没有m3u8参数，检查旧的source参数
                this.getUrl();
            }
        },

        // 全选/反选
        checkAll() {
            this.isCheckedAll = !this.isCheckedAll;
            this.tasks.forEach(item => {
                item['checked'] = this.isCheckedAll;
            });
        },

        // 获取地址栏参数
        getUrl() {
            let {
                href
            } = location;
            if (href.indexOf('?source=') > -1 || href.indexOf('&source=') > -1) {
                this.url = href.split('source=')[1];
                if (this.url) {
                    this.rangeDownload.isShowRange = false;
                    this.rangeDownload.startSegment = 1;
                    this.rangeDownload.endSegment = '';
                    this.getTitle();
                    this.create(false);
                }
            }
        },

        // 新建下载窗口
        add(autoFill = false) {
            this.url = autoFill ? this.url : '';
            this.title = autoFill ? this.title : '';
            this.rangeDownload.isShowRange = false;
            this.rangeDownload.startSegment = 1;
            this.rangeDownload.endSegment = '';
            this.showModal('modal-add');
            // 自动获取焦点
            this.$nextTick(() => {
                if (this.$refs.url) {
                    this.$refs.url.focus();
                }
            });
        },

        // 设置下载范围
        setRange() {
            // 判断是否正在下载索引
            if (this.loadingIndex !== null) {
                return;
            }

            if (!this.url) {
                this.error('请输入m3u8地址');
                return;
            }

            this.isForRangeDownload = true;
            this.create(true);
        },

        // 开始范围下载
        getRange() {
            this.closeModal('modal-range');
            this.isForRangeDownload = false;
            this.create(false);
        },

        // 获取标题
        getTitle() {
            if (!this.url) {
                return;
            }
            try {
                let targetUrl = new URL(this.url);
                this.title = targetUrl.searchParams.get('title') || this.formatTime(new Date(), 'YYYY_MM_DD hh_mm_ss');
            } catch (e) {
                this.title = '';
            }
        },

        // 检测是否是主播放列表
        isMasterPlaylist(m3u8Str) {
            return m3u8Str.includes('#EXT-X-STREAM-INF');
        },

        // 解析流信息
        parseStreamInfo(m3u8Str, baseUrl) {
            const streams = [];
            const lines = m3u8Str.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('#EXT-X-STREAM-INF:')) {
                    const bandwidth = line.match(/BANDWIDTH=(\d+)/)?.[1] || '';
                    const resolution = line.match(/RESOLUTION=([^\s,]+)/)?.[1] || '';
                    const name = line.match(/NAME="([^"]+)"/)?.[1] || '';

                    // 下一行应该是URL
                    if (i + 1 < lines.length) {
                        const url = lines[i + 1].trim();
                        if (url && !url.startsWith('#')) {
                            streams.push({
                                url: this.applyURL(url, baseUrl),
                                bandwidth: parseInt(bandwidth) || 0,
                                resolution: resolution || 'Unknown',
                                name: name || `${resolution || ''} ${bandwidth ? (parseInt(bandwidth) / 1000) + 'kbps' : 'Unknown'}`
                            });
                            i++; // 跳过URL行
                        }
                    }
                }
            }

            // 按带宽排序（最高优先）
            streams.sort((a, b) => b.bandwidth - a.bandwidth);

            return streams;
        },

        // 创建下载任务
        create(onlyGetRange) {
            this.url = this.url.trim();
            this.urlError = false;
            if (!this.url) {
                this.error('请输入m3u8地址');
                this.urlError = true;
                return;
            }

            // 判断是否正在下载索引
            if (this.loadingIndex !== null) {
                return;
            }

            // 链接对象
            let targetUrl;
            try {
                targetUrl = new URL(this.url);
            } catch (e) {
                this.error('M3U8链接格式错误，请重新输入');
                return;
            }

            // 判断targetUrl中是否包含_ignore参数
            if (targetUrl.searchParams.has('_ignore')) {
                let ignores = targetUrl.searchParams.get('_ignore');
                ignores = ignores.split(',');
                targetUrl.searchParams.delete('_ignore');
                ignores.forEach((ignore) => {
                    targetUrl.searchParams.delete(ignore);
                });
                this.url = targetUrl.href;
            }

            // 开始时间
            this.beginTime = new Date();

            // 获取m3u8文件
            let loading = this.loading('正在下载 m3u8 文件，请稍后...');
            this.loadingIndex = loading;

            this.ajax({
                url: this.url,
                success: (m3u8Str) => {
                    this.loading(false, loading);
                    this.loadingIndex = null;

                    if (m3u8Str.substring(0, 7).toUpperCase() !== '#EXTM3U') {
                        this.error('无效的 m3u8 链接');
                        return;
                    }

                    // 检查是否是主播放列表
                    if (this.isMasterPlaylist(m3u8Str)) {
                        // 解析子播放列表信息
                        const streams = this.parseStreamInfo(m3u8Str, this.url);

                        if (streams.length === 0) {
                            this.error('未找到有效的子播放列表');
                            return;
                        }

                        // 保存streams和当前URL的状态
                        this.streams = streams;
                        this.masterUrl = this.url;
                        this.masterTitle = this.title;

                        // 关闭当前弹窗，显示清晰度选择弹窗
                        if (!this.isForRangeDownload) {
                            this.closeModal('modal-add');
                        } else {
                            this.closeModal('modal-range');
                        }

                        // 延迟显示流选择模态框，确保其他模态框已关闭
                        setTimeout(() => {
                            this.showModal('modal-stream-select');
                        }, 300);
                        return;
                    }

                    // 处理常规M3U8文件的逻辑
                    this.processM3U8Content(m3u8Str, onlyGetRange);
                },
                fail: () => {
                    this.loading(false, loading);
                    this.loadingIndex = null;
                    this.error('m3u8链接不正确，请查看链接是否有效，或重试!');
                    this.closeModal('modal-add');
                }
            });
        },

        // 处理M3U8内容
        processM3U8Content(m3u8Str, onlyGetRange) {
            if (!this.rangeDownload.isShowRange && !onlyGetRange) {
                this.closeModal('modal-add');
            }

            // 创建新任务
            const task = {
                id: 't_' + this.randomNum(),
                url: this.url,
                title: this.title,
                type: this.type,
                stream: this.stream,
                checked: false,
                status: 'ready',
                finishList: [],
                tsUrlList: [],
                requests: [],
                mediaFileList: [],
                downloadIndex: 0,
                downloading: false,
                durationSecond: 0,
                beginTime: this.beginTime,
                errorNum: 0,
                finishNum: 0,
                retryNum: 3,
                retryCountdown: 0,
                streamWriter: this.stream ? window.streamSaver.createWriteStream(`${this.title}.${this.type === 'MP4' ? 'mp4' : 'ts'}`).getWriter() : null,
                streamDownloadIndex: 0,
                rangeDownload: {
                    isShowRange: this.rangeDownload.isShowRange,
                    startSegment: this.rangeDownload.startSegment,
                    endSegment: this.rangeDownload.endSegment,
                    targetSegment: 1,
                },
                aesConf: {
                    method: '',
                    uri: '',
                    iv: '',
                    key: '',
                    decryption: null,
                    stringToBuffer: function(str) {
                        return new TextEncoder().encode(str);
                    },
                },
            };

            // 提取TS视频片段地址和计算时长
            m3u8Str.split('\n').forEach((str) => {
                if (/^[^#]/.test(str)) {
                    task.tsUrlList.push(this.applyURL(str, task.url));
                    task.finishList.push({
                        title: str,
                        status: ''
                    });
                }
            });

            // 仅获取视频片段数
            if (true === onlyGetRange) {
                this.rangeDownload.isShowRange = true;
                this.rangeDownload.endSegment = task.tsUrlList.length;
                this.rangeDownload.targetSegment = task.tsUrlList.length;
                this.showModal('modal-range');
                return;
            } else {
                let startSegment = Math.max(task.rangeDownload.startSegment || 1, 1); // 最小为 1
                let endSegment = Math.max(task.rangeDownload.endSegment || task.tsUrlList.length, 1);
                startSegment = Math.min(startSegment, task.tsUrlList.length); // 最大为this.tsUrlList.length
                endSegment = Math.min(endSegment, task.tsUrlList.length);
                task.rangeDownload.startSegment = Math.min(startSegment, endSegment);
                task.rangeDownload.endSegment = Math.max(startSegment, endSegment);
                task.rangeDownload.targetSegment = task.rangeDownload.endSegment - task.rangeDownload.startSegment + 1;
                task.downloadIndex = task.rangeDownload.startSegment - 1;
            }

            // 获取需要下载的MP4视频长度
            let infoIndex = 0;
            m3u8Str.split('\n').forEach(item => {
                if (item.toUpperCase().indexOf('#EXTINF:') > -1) { // 计算视频总时长，设置mp4信息时使用
                    infoIndex++;
                    if (task.rangeDownload.startSegment <= infoIndex && infoIndex <= task.rangeDownload.endSegment) {
                        task.durationSecond += parseFloat(item.split('#EXTINF:')[1]);
                    }
                }
            });

            // 检测视频AES加密
            if (m3u8Str.indexOf('#EXT-X-KEY') > -1) {
                task.aesConf.method = (m3u8Str.match(/(.*METHOD=([^,\s]+))/) || ['', '', ''])[2];
                task.aesConf.uri = (m3u8Str.match(/(.*URI="([^"]+))"/) || ['', '', ''])[2];
                task.aesConf.iv = (m3u8Str.match(/(.*IV=([^,\s]+))/) || ['', '', ''])[2];
                task.aesConf.iv = task.aesConf.iv ? task.aesConf.stringToBuffer(task.aesConf.iv) : '';
                task.aesConf.uri = this.applyURL(task.aesConf.uri, task.url);

                this.getAES(task);
            } else if (task.tsUrlList.length > 0) {
                this.addTask(task);
                this.downloadTS();
            } else {
                this.error('资源为空，请查看链接是否有效');
                this.closeModal('modal-add');
            }
        },

        // 选择流
        selectStream(stream) {
            // 关闭流选择模态框
            this.closeModal('modal-stream-select');

            // 更新标题
            if (this.masterTitle) {
                this.title = this.masterTitle + ' (' + stream.name + ')';
            }

            // 更新URL为所选流
            this.url = stream.url;

            // 加载子播放列表
            let loading = this.loading('正在加载选定的播放列表...');
            this.loadingIndex = loading;

            this.ajax({
                url: this.url,
                success: (m3u8Str) => {
                    this.loading(false, loading);
                    this.loadingIndex = null;

                    if (m3u8Str.substring(0, 7).toUpperCase() !== '#EXTM3U') {
                        this.error('无效的 m3u8 链接');
                        return;
                    }

                    // 检查是否还是主播放列表
                    if (this.isMasterPlaylist(m3u8Str)) {
                        // 处理主播放列表
                        const streams = this.parseStreamInfo(m3u8Str, this.url);

                        if (streams.length === 0) {
                            this.error('未找到有效的子播放列表');
                            return;
                        }

                        // 更新stream并再次显示选择模态框
                        this.streams = streams;
                        this.masterUrl = this.url;
                        this.showModal('modal-stream-select');
                        return;
                    }

                    // 处理子播放列表
                    this.processM3U8Content(m3u8Str, false);
                },
                fail: () => {
                    this.loading(false, loading);
                    this.loadingIndex = null;
                    this.error('无法加载选定的播放列表');
                }
            });
        },

        // 加入任务
        addTask(task) {
            this.tasks.unshift(task);
            if (this.currTask && this.currTask.status === 'downloading') {
                console.log('当前任务正在下载，跳过');
                return;
            }
            this.currTask = this.tasks[0];
        },

        // 显示片段窗口
        showSegment(item) {
            this.segment = item;
            this.showModal('modal-segment');
        },

        // 打开窗口
        showModal(id) {
            this.paste = false;
            this.modalList[id] = {
                show: true,
                showing: true,
                closing: false
            };
            setTimeout(() => {
                this.modalList[id].showing = false;
            }, 500);
            // 如果是添加下载弹窗，强制刷新表单值
            if (id === 'modal-setting') {
                this.type = this.type;
                this.stream = this.stream;
            }
        },

        // 关闭窗口
        closeModal(id) {
            if (id !== 'modal-player' && id !== 'modal-range') {
                this.paste = true;
            }

            // 安全检查：确保modalList[id]存在
            if (this.modalList[id]) {
                this.modalList[id].closing = true;
                setTimeout(() => {
                    this.modalList[id].show = false;
                    this.modalList[id].closing = false;
                }, 300);
            }
        },

        // 显示全局提示
        message(msg, type, duration = 3000) {
            type = type || 'info';
            msg = msg || '';
            let key = 'm-' + this.randomNum();
            this.messageList[key] = {
                type: type,
                content: msg,
                appear: true,
                leave: false
            };
            setTimeout(() => {
                if (this.messageList[key]) {
                    this.messageList[key].appear = false;
                }
            }, 500);
            if (duration) {
                setTimeout(() => {
                    if (this.messageList[key]) {
                        this.messageList[key].leave = true;
                    }
                }, duration);
                setTimeout(() => {
                    delete this.messageList[key];
                }, duration + 500);
            }

            if (type === 'loading') {
                return key;
            }
        },

        success(msg) {
            this.message(msg, 'success', 2000);
        },

        error(msg) {
            this.message(msg, 'error');
        },

        info(msg) {
            this.message(msg, 'info');
        },

        warning(msg) {
            this.message(msg, 'warning');
        },

        loading(msg, key) {
            if (false === msg) {
                if (this.messageList[key]) {
                    this.messageList[key].leave = true;
                    setTimeout(() => {
                        delete this.messageList[key];
                        this.loadingIndex = null;
                    }, 500);
                } else {
                    this.loadingIndex = null;
                }
            } else {
                return this.message(msg, 'loading', 0);
            }
        },

        randomNum: function() {
            return Math.floor(Math.random() * (999999 - 2)) + 1;
        },

        // ajax 请求
        ajax(options) {
            options = options || {};
            let xhr = new XMLHttpRequest();
            if (options.type === 'file') {
                xhr.responseType = 'arraybuffer';
            }

            // 添加一个用于存储xhr对象的属性
            options.xhr = xhr;
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    let status = xhr.status;
                    if (status >= 200 && status < 300) {
                        options.success && options.success(xhr.response);
                    } else {
                        options.fail && options.fail(status);
                    }
                }
            };

            xhr.open("GET", options.url, true);
            xhr.send(null);
            return xhr;
        },

        // 拷贝剪切板
        copyToClipboard(content) {
            if (!document.queryCommandSupported('copy')) {
                return false;
            }
            let $input = document.createElement('textarea');
            $input.style.opacity = '0';
            $input.value = content;
            document.body.appendChild($input);
            $input.select();
            const result = document.execCommand('copy');
            document.body.removeChild($input);
            $input = null;
            this.success('复制成功');
            return result;
        },

        // 合成URL
        applyURL(targetURL, baseURL) {
            baseURL = baseURL || location.href;
            if (targetURL.indexOf('http') === 0) {
                // 当前页面使用 https 协议时，强制使 ts 资源也使用 https 协议获取
                if (location.href.indexOf('https') === 0) {
                    return targetURL.replace('http://', 'https://');
                }
                return targetURL;
            } else if (targetURL[0] === '/') {
                let domain = baseURL.split('/');
                return domain[0] + '//' + domain[2] + targetURL;
            } else {
                let domain = baseURL.split('/');
                domain.pop();
                return domain.join('/') + '/' + targetURL;
            }
        },

        // 获取AES配置
        getAES(task) {
            let loading = this.loading('正在获取视频解密信息...');
            this.loadingIndex = loading;
            this.ajax({
                type: 'file',
                url: task.aesConf.uri,
                success: (key) => {
                    this.loading(false, loading);
                    this.loadingIndex = null;

                    task.aesConf.key = key;
                    task.aesConf.decryption = new AESDecryptor();
                    task.aesConf.decryption.constructor();
                    task.aesConf.decryption.expandKey(task.aesConf.key);

                    // 加入任务列表
                    this.addTask(task);
                    this.downloadTS();
                },
                fail: () => {
                    this.loading(false, loading);
                    this.loadingIndex = null;
                    this.error('视频解密失败');
                }
            });
        },

        // 下载分片
        downloadTS() {
            // 设置为下载中
            this.currTask.status = 'downloading';

            let download = () => {
                let isPause = this.currTask.status === 'pause';
                let index = this.currTask.downloadIndex;

                if (index >= this.currTask.rangeDownload.endSegment) {
                    return;
                }

                if (isPause) {
                    return;
                }

                this.currTask.downloadIndex++;

                if (this.currTask.finishList[index] && this.currTask.finishList[index].status === '') {
                    this.currTask.finishList[index].status = 'is-downloading';
                    let request = this.ajax({
                        url: this.currTask.tsUrlList[index],
                        type: 'file',
                        success: (file) => {
                            this.dealTS(file, index, () => this.currTask.downloadIndex < this.currTask.rangeDownload.endSegment && !isPause && download());
                        },
                        fail: () => {
                            this.currTask.errorNum++;
                            this.currTask.finishList[index].status = 'is-error';
                            if (this.currTask.downloadIndex < this.currTask.rangeDownload.endSegment) {
                                !isPause && download();
                            } else if (this.currTask.finishNum + this.currTask.errorNum === this.currTask.rangeDownload.targetSegment) {
                                this.togglePause(this.currTask, true);
                            }
                        }
                    });
                    this.currTask.requests.push(request);
                } else if (this.currTask.downloadIndex < this.currTask.rangeDownload.endSegment) { // 跳过已经成功的片段
                    !isPause && download();
                }
            };

            // 建立多少个 ajax 线程
            for (let i = 0; i < Math.min(6, this.currTask.rangeDownload.targetSegment - this.currTask.finishNum); i++) {
                download();
            }
        },

        // 处理ts片段，AES解密、mp4转码
        dealTS(file, index, callback) {
            const data = this.currTask.aesConf.uri ? this.aesDecrypt(file, index) : file;

            // mp4转码
            this.conversionMp4(data, index, (afterData) => {
                // 判断文件是否需要解密
                this.currTask.mediaFileList[index - this.currTask.rangeDownload.startSegment + 1] = afterData;
                this.currTask.finishList[index].status = 'is-success';
                this.currTask.finishNum++;

                if (this.currTask.streamWriter) {
                    for (let index = this.currTask.streamDownloadIndex; index < this.currTask.mediaFileList.length; index++) {
                        if (this.currTask.mediaFileList[index]) {
                            this.currTask.streamWriter.write(new Uint8Array(this.currTask.mediaFileList[index]));
                            this.currTask.mediaFileList[index] = null;
                            this.currTask.streamDownloadIndex = index + 1;
                        } else {
                            break;
                        }
                    }

                    if (this.currTask.streamDownloadIndex >= this.currTask.rangeDownload.targetSegment) {
                        this.currTask.status = 'done';
                        this.currTask.requests = [];
                        this.currTask.streamWriter.close();
                        this.nextTask();
                    }
                } else if (this.currTask.finishNum === this.currTask.rangeDownload.targetSegment) {
                    this.currTask.status = 'done';
                    this.currTask.requests = [];
                    this.nextTask();
                    this.downloadFile(this.currTask.mediaFileList, this.currTask.title);
                } else if (this.currTask.finishNum + this.currTask.errorNum === this.currTask.rangeDownload.targetSegment) {
                    this.togglePause(this.currTask, true);
                }

                callback && callback();
            });
        },

        // ts片段的AES解码
        aesDecrypt(data, index) {
            let iv = this.currTask.aesConf.iv || new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, index]);
            return this.currTask.aesConf.decryption.decrypt(data, 0, iv.buffer || iv, true);
        },

        // 转码为mp4
        conversionMp4(data, index, callback) {
            if (this.currTask.type === 'MP4') {
                let transMuxer = new muxjs.Transmuxer({
                    keepOriginalTimestamps: true,
                    duration: parseInt(this.currTask.durationSecond),
                });

                transMuxer.on('data', segment => {
                    if (index === this.currTask.rangeDownload.startSegment - 1) {
                        let data = new Uint8Array(segment.initSegment.byteLength + segment.data.byteLength);
                        data.set(segment.initSegment, 0);
                        data.set(segment.data, segment.initSegment.byteLength);
                        callback(data.buffer);
                    } else {
                        callback(segment.data);
                    }
                });

                transMuxer.push(new Uint8Array(data));
                transMuxer.flush();
            } else {
                callback(data);
            }
        },

        // 格式化时间
        formatTime(date, formatStr) {
            const formatType = {
                Y: date.getFullYear(),
                M: date.getMonth() + 1,
                D: date.getDate(),
                h: date.getHours(),
                m: date.getMinutes(),
                s: date.getSeconds(),
            };

            return formatStr.replace(
                /Y+|M+|D+|h+|m+|s+/g,
                target => (new Array(target.length).join('0') + formatType[target[0]]).substr(-target.length)
            );
        },

        // 下载整合后的TS文件
        downloadFile(fileDataList, fileName) {
            this.success('视频整合中，请留意浏览器下载!');
            let fileBlob = null;
            let a = document.createElement('a');

            if (this.currTask.type === 'MP4') {
                fileBlob = new Blob(fileDataList, {
                    type: 'video/mp4'
                }); // 创建一个Blob对象，并设置文件的 MIME 类型
                a.download = fileName + '.mp4';
            } else {
                fileBlob = new Blob(fileDataList, {
                    type: 'video/MP2T'
                }); // 创建一个Blob对象，并设置文件的 MIME 类型
                a.download = fileName + '.ts';
            }

            a.href = URL.createObjectURL(fileBlob);
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
        },

        // 暂停与恢复
        togglePause(task, retry = false) {
            if (this.currTask.id === task.id) {
                // 当前任务
                this.currTask.status = this.currTask.status === 'pause' ? 'downloading' : 'pause';
                if (this.currTask.status === 'pause') {
                    this.abortRequest(this.currTask, () => {
                        if (retry === true && this.currTask.retryNum) {
                            this.currTask.retryNum--;
                            this.currTask.retryCountdown = 3;
                            let countdown = setInterval(() => {
                                this.currTask.retryCountdown--;
                                if (this.currTask.retryCountdown === 0) {
                                    clearInterval(countdown);
                                    this.currTask.status = 'downloading';
                                    this.retryAll(true);
                                }
                            }, 1000);
                        } else {
                            this.nextTask();
                        }
                    });
                } else {
                    this.retryAll(true);
                }
            } else {
                // 切换任务
                if (task.status === 'pause') {
                    if (this.currTask.status === 'downloading') {
                        // 有其他任务正在下载,设置当前任务进入等待
                        task.status = 'ready';
                    } else {
                        // 执行当前任务
                        this.currTask = task;
                        this.currTask.status = 'downloading';
                        this.retryAll(true);
                    }
                }
            }
        },

        // 重新下载某个片段
        retry(index) {
            if (this.currTask.finishList[index].status === 'is-error') {
                if (this.currTask.id && this.currTask.id !== this.segment.id && this.currTask.status === 'downloading') {
                    this.error('当前有其他任务正在执行，无法重试');
                    return;
                }

                this.currTask = this.segment;
                this.currTask.finishList[index].status = 'is-downloading';
                this.ajax({
                    url: this.currTask.tsUrlList[index],
                    type: 'file',
                    success: (file) => {
                        this.currTask.errorNum--;
                        this.dealTS(file, index);
                    },
                    fail: () => {
                        this.currTask.finishList[index].status = 'is-error';
                    }
                });
            }
        },

        // 重新下载所有错误片段
        retryAll(forceRestart) {
            if (!this.currTask.finishList.length || this.currTask.status === 'pause') {
                return;
            }

            let firstErrorIndex = this.currTask.downloadIndex; // 没有错误项目，则每次都递增
            this.currTask.finishList.forEach((item, index) => { // 重置所有错误片段状态
                if (item.status === 'is-error') {
                    item.status = '';
                    firstErrorIndex = Math.min(firstErrorIndex, index);
                }
            });

            this.currTask.errorNum = 0;
            // 已经全部下载进程都跑完了，则重新启动下载进程
            if (this.currTask.downloadIndex >= this.currTask.rangeDownload.endSegment || forceRestart) {
                this.currTask.downloadIndex = firstErrorIndex;
                this.downloadTS();
            } else { // 否则只是将下载索引，改为最近一个错误的项目，从那里开始遍历
                this.currTask.downloadIndex = firstErrorIndex;
            }
        },

        // 强制下载现有片段
        forceDownload() {
            if (this.currTask.mediaFileList.length) {
                this.downloadFile(this.currTask.mediaFileList, this.currTask.title);
            } else {
                this.error('当前无已下载片段');
            }
        },

        // 删除任务
        deleteTask(index) {
            if (index >= 0) {
                let task = this.tasks[index];
                this.abortRequest(task, () => {
                    this.tasks.splice(index, 1);
                    if (this.currTask && this.currTask.id === task.id) {
                        this.currTask.streamWriter && this.currTask.streamWriter.close();
                        this.nextTask();
                    }
                });
            } else {
                let taskIds = [];
                this.tasks = this.tasks.filter(task => {
                    if (task.checked) {
                        this.abortRequest(task);
                        taskIds.push(task.id);
                    } else {
                        return true;
                    }
                });

                if (this.currTask && taskIds.includes(this.currTask.id)) {
                    this.currTask.streamWriter && this.currTask.streamWriter.close();
                    this.nextTask();
                }
            }
        },

        // 终止请求
        abortRequest(task, callback) {
            if (task.requests && task.requests.length) {
                task.status = 'pause';
                for (let i = task.requests.length - 1; i >= 0; i--) {
                    if (task.requests[i].readyState !== 4) {
                        task.requests[i].abort();
                    }
                    task.requests.splice(i, 1);
                }
            }

            callback && callback();
        },

        // 开启下一个可执行任务
        nextTask() {
            for (let i = this.tasks.length - 1; i >= 0; i--) {
                if (this.tasks[i].status === 'ready') {
                    this.currTask = this.tasks[i];
                    this.currTask.status = 'downloading';
                    this.retryAll(true);
                    break;
                }
            }
        },

        // 监听页面粘贴事件
        onPaste(event) {
            if (this.paste) {
                // 处理粘贴的内容
                this.url = event.clipboardData.getData('text');
                this.rangeDownload.isShowRange = false;
                this.rangeDownload.startSegment = 1;
                this.rangeDownload.endSegment = '';
                this.getTitle();
                this.create(false);
            }
        },

        // 批量开启下载
        start() {
            for (let i = this.tasks.length - 1; i >= 0; i--) {
                if (this.tasks[i].checked) {
                    if (this.currTask && this.currTask.status === 'downloading' && this.currTask.id !== this.tasks[i].id) {
                        this.tasks[i].status = 'ready';
                    } else {
                        this.currTask = this.tasks[i];
                        this.currTask.status = 'downloading';
                        this.retryAll(true);
                    }
                }
            }
        },

        // 批量暂停下载
        pause() {
            let taskIds = [];
            this.tasks.forEach(task => {
                if (task.checked) {
                    this.abortRequest(task);
                    task.status = 'pause';
                    taskIds.push(task.id);
                }
            });

            if (this.currTask && taskIds.includes(this.currTask.id)) {
                this.nextTask();
            }
        },

        // 播放视频
        play(url) {
            if (!url) {
                this.error('请输入m3u8地址');
                return;
            }
            this.showModal('modal-player');
            this.dp = new DPlayer({
                container: document.getElementById('player'),
                autoplay: true,
                airplay: false,
                video: {
                    url: url,
                    type: 'hls',
                },
            });
        },

        // 关闭播放
        closePlayer() {
            this.closeModal('modal-player');
            this.dp.destroy();
            this.dp = null;
        },

        // 格式化时长
        formatDuration(duration) {
            duration = parseInt(duration);
            const hours = Math.floor(duration / 3600);
            const minutes = Math.floor((duration % 3600) / 60);
            const seconds = duration % 60;
            return `${hours.toString().padStart(2, '0')}` + ':' + `${minutes.toString().padStart(2, '0')}` + ':' + `${seconds.toString().padStart(2, '0')}`;
        },
    }
}).mount('#app');